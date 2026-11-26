# Business Opportunity Finder — Phase 3 backend

## Production deployment

- Project: Swayphics Web
- Edge Function: `submit-business-assessment`
- Function authentication: gateway JWT verification disabled for the public assessment route; application validation, origin checks, payload limits, honeypot, HMAC-based rate limiting and server-side validation are enforced in the handler.
- Assessment version: `bof-2026-11-v1`
- Contact notice version: `bof-contact-v1`

## Public endpoint

`POST /functions/v1/submit-business-assessment`

The endpoint has two actions:

### Complete an assessment

```json
{
  "action": "complete_assessment",
  "assessment_version": "bof-2026-11-v1",
  "submission_key": "6e4d8ba9-16e8-4a7c-96cb-1374a63cfe12",
  "business_profile": {
    "business_name": "Example Studio",
    "location": "Pretoria"
  },
  "responses": [
    { "question_id": "industry", "answer": "beauty_personal_care" },
    { "question_id": "discovery", "answer": ["instagram", "google_business"] },
    { "question_id": "contactMethods", "answer": ["whatsapp"] },
    { "question_id": "friction", "answer": ["missed_followups"] },
    { "question_id": "priority", "answer": "responses" }
  ],
  "website": ""
}
```

The server validates the full question set and generates the findings and report. The browser cannot submit its own trusted findings, scores or recommended services. The response contains the immediate report and an assessment reference. Retrying the same submission key with the same normalized payload returns the original record; reusing the key with different answers returns a conflict.

### Request contact after the report

```json
{
  "action": "request_contact",
  "assessment_id": "returned-assessment-uuid",
  "submission_key": "same-submission-uuid",
  "contact_request": {
    "name": "Business owner",
    "email": "owner@example.com",
    "phone": "",
    "preferred_contact_method": "email",
    "message": "",
    "notice_accepted": true,
    "notice_version": "bof-contact-v1"
  },
  "website": ""
}
```

A valid contact request creates one `website_enquiries` row with source `Business Opportunity Finder` and the assessment link. It uses the existing enquiry notification trigger. The assessment row is updated to `contact_requested`; no lead is created and no contacted timestamp is set. Retries return the existing enquiry reference rather than creating duplicates.

## Database controls

- `business_assessments` stores versioned answers, server-generated findings and the report snapshot.
- Authenticated Swayphics administrators can read assessment records through RLS.
- Anonymous users have no direct table access.
- `service_role` is the only role granted table-write and submission-RPC privileges.
- `business_assessment_rate_limits` stores HMAC-SHA-256 identifiers, not raw IP addresses or email addresses.
- `request_business_assessment_contact` is an invoker-rights RPC with execute permission restricted to `service_role`.
- The existing `submit-enquiry` function and `convert_swayphics_enquiry_to_lead` RPC are unchanged.

## Current application integration

- The standalone Business Opportunity Finder page now submits the five validated answers to the endpoint and renders the server-generated report.
- The respondent can request contact only after the report is displayed. The request has a separate contact notice and consent checkbox; details are submitted to the linked enquiry path, not stored in the assessment JSON.
- The page remains `noindex, nofollow`. The report and step disclosures explain that answers are stored and that independent website/social/Google Business Profile inspection has not yet occurred.
- A separate `admin-dashboard/business-assessments.html` page uses the existing Swayphics admin access and refresh tokens, verifies the Supabase user and the `is_swayphics_admin` RPC, and reads assessment records under RLS.
- The admin viewer is read-only. It shows the assessment, evidence classifications, recommendations, and linked enquiry contact details when a contact request exists. It does not expose the submission key.
- The CRM navigation adds a Business assessments destination only after the existing admin session resolves successfully. Assessment-linked enquiry cards receive a Review assessment link, and their generic `Contacted → Lead` action is removed so they cannot be converted through the old Website/contacted conversion path.
- Assessment-to-lead conversion, linked lead history, proposal snapshot handoff, and external digital-presence inspection remain separate follow-on work.

## Rollout boundary

The database and Edge Function are deployed in production. The public assessment and admin viewer code is committed only to the unmerged feature branch / draft PR; neither page has been deployed to the public website or production admin dashboard. A positive live HTTP submission against the new endpoint and a signed-in browser review of the new admin page have not yet been performed. Keep the page noindex until those checks, conversion-path implementation, privacy review and launch review are complete.


## Draft: assessment-to-lead conversion (not deployed)

A separate migration has been prepared on the feature branch:
`20261126170200_business_assessment_lead_conversion.sql`.

It introduces an admin-authorised, SECURITY DEFINER RPC with a fixed empty search path. The RPC has three explicit actions:

- `preview`: checks exact email, normalised phone and business-name matches and returns possible candidates without changing records.
- `link_existing`: links the assessment and enquiry to a selected matching lead without changing that lead's details, source, stage or contact history.
- `create_new`: creates a new lead only after explicit confirmation. The new lead uses source `Business Opportunity Finder`, status `new`, and the converting administrator as assignee. It does not set `last_contacted_at` or a follow-up date. The linked enquiry moves to its supported `converted` status; its `contacted_at` remains unchanged.

The admin viewer now contains the matching and conversion controls, but they are not production-ready until this separate migration is approved, applied and tested against real assessment/contact records. This draft migration has not been applied to production.
