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

## Rollout boundary

The Edge Function and database are deployed. The standalone preview still needs its browser submission flow, post-report contact form, and admin assessment viewer integrated before the complete feature is launched. The page remains noindex until that end-to-end review is complete.
