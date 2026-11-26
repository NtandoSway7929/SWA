# Swayphics Business Opportunity Finder
## Phase 1 — implementation specification

**Status:** Design baseline only. No production schema, deployed Edge Function, public page, admin page, or live data has been changed by this specification.

**Repository baseline:** `main` at `5ef48d7d3720bdaca60411f4515066cae2737807` (22 November 2026).

## 1. Product boundary

The Business Opportunity Finder is a guided diagnostic for businesses with and without websites. It is not a website-only audit, generic lead form, or replacement for InnerMe.

The first release should:
- guide a business owner through a short adaptive assessment;
- generate an immediately useful report;
- separate self-reported answers from independently observed evidence;
- recommend only improvements supported by the available evidence;
- offer an optional contact request after the report is available;
- route contact requests into the existing Swayphics enquiry and lead workflow.

The first release must not claim to inspect a website, social account, or Google Business Profile unless a separate inspection step has actually retrieved and checked that source. The initial release can be answer-led. Independent digital-presence inspection can follow as a separately testable capability.

No universal score or arbitrary percentage should be produced. Findings should be ranked by relevance, evidence quality, and practical importance.

## 2. Existing infrastructure to reuse

| Existing component | Intended use |
|---|---|
| `website_enquiries` | Existing intake queue for users who ask Swayphics to contact them |
| `convert_swayphics_enquiry_to_lead(uuid)` | Preserve for existing website enquiries; do not silently repurpose |
| `leads` | Existing sales pipeline after an administrator converts a qualified assessment enquiry |
| `lead_proposals.assessment_snapshot` | Preserve the assessment context at proposal-draft time |
| Admin notification trigger on `website_enquiries` | Notify the team when an assessment contact request creates an enquiry |
| Existing lead profile and proposal UI | Extend only after the assessment record can be safely retrieved |
| Existing InnerMe provider infrastructure | Optional later assistance with report wording; not the source of facts or assessment rules |

### Production facts verified during the read-only audit

- The production Supabase project has 108 applied migration entries.
- The repository has 83 files under `supabase/migrations/`.
- After normalising timestamped names, 77 unique migration names match. Four unique repository migration names are not present in live migration history; 29 unique live migration names are not represented by matching files in the repository migration folder. Duplicate names also exist on both sides.
- The deployed `swayphics-ai` function is version 152. Its `index.ts` and all ten companion modules match the corresponding files in `main`.
- The deployed `submit-enquiry` function is version 37. It differs from the repository source. In particular, the repository version's email-count SELECT is not in production because the deployed function intentionally avoids SELECT access to `website_enquiries` for `service_role`.
- `website_enquiries` currently has `name`, `business_name`, `email`, `phone`, `service`, `message`, `status`, `created_at`, `contacted_at`, and `converted_lead_id`. It does not currently have a structured assessment link or source column.
- The existing enquiry-to-lead RPC is a `SECURITY DEFINER` function. It checks admin access, locks the enquiry row, attempts to find a matching lead, creates or updates a lead, marks the enquiry contacted, and returns the lead ID.
- The existing lead conversion function assigns new leads source `Website` and status `contacted`. That is not suitable for an uncontacted Business Opportunity Finder request.
- The current lead-assessment fields are text columns intended for internal research; they do not provide versioned assessment history.
- A database rate-limit table and RPC already exist: `enquiry_rate_limits` and `check_and_increment_enquiry_rate_limit(text, integer, integer)`. The RPC is callable by `service_role`, not public or authenticated users. Its first-use path should be concurrency-tested before reuse because it selects for update before inserting a missing identifier row.

## 3. Proposed data model

### 3.1 New table: `public.business_assessments`

One row represents one completed assessment. Repeat assessments create new rows; they never overwrite previous reports.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid primary key | Assessment identity |
| `assessment_version` | text, required | Version of the questions and rules used |
| `status` | text, required | `completed`, `contact_requested`, `converted`, or `archived` |
| `business_name` | text, nullable | Name supplied by the respondent |
| `industry` | text, required | Validated industry identifier |
| `business_profile` | jsonb object | Business context such as location, services and declared channels |
| `responses` | jsonb array | Ordered question IDs and validated answers |
| `findings` | jsonb array | Evidence-labelled diagnostic findings generated server-side |
| `report` | jsonb object | Customer-facing report generated from the validated answers and findings |
| `contact_requested` | boolean, default false | Whether the respondent explicitly asked Swayphics to contact them |
| `submission_key` | uuid, unique | Idempotency key to prevent duplicate records on retry |
| `lead_id` | uuid, nullable FK to leads | Lead created or matched by an administrator |
| `submitted_at` | timestamptz | Completion time |
| `created_at`, `updated_at` | timestamptz | Record timestamps |

JSON shape constraints should enforce an object for `business_profile` and `report`, and arrays for `responses` and `findings`. Add indexes for recent assessments, status, industry and non-null `lead_id`.

The assessment record should not duplicate contact details unnecessarily. When contact is requested, those details belong in the linked `website_enquiries` row.

### 3.2 Extend `public.website_enquiries`

Add:
- `source` text, non-null, default `Website` (existing submissions continue to behave as before);
- `assessment_id` uuid, nullable FK to `business_assessments(id)`, with a unique partial index for non-null values.

The assessment submission function creates an enquiry only when the respondent asks to be contacted. The enquiry receives source `Business Opportunity Finder` and the assessment link. The existing notification trigger should continue to notify the Swayphics team.

### 3.3 Link assessments to leads

Keep `business_assessments.lead_id` nullable and reference `leads(id)`. One lead may have several assessment records over time. This avoids adding another free-text assessment field to `leads` and retains history.

Do not modify `lead_proposals.assessment_snapshot` for the first release. When a proposal is drafted, include the assessment ID and the relevant findings/report snapshot in the existing JSONB snapshot.

## 4. Public submission contract

Proposed endpoint: `POST /functions/v1/submit-business-assessment`.

The browser sends only:
- `assessment_version`;
- `submission_key`;
- `business_profile`;
- `responses`;
- `contact_request` (false by default; contact name, email, phone and preferred channel only when true);
- the version of the privacy/contact notice accepted where relevant.

The browser must not submit trusted `findings`, a score, recommended services, or the final report. The server validates question IDs, answer types, required fields and the assessment version, then generates the findings and report from approved rules.

The response should return the completed report and an opaque assessment reference. The reference alone must never grant access to a private report through a public database query. Immediate report display is part of the submission response. A later report-retrieval feature would require a separate short-lived token design.

A contact request should create at most one enquiry for one assessment. The assessment and enquiry should be written atomically, ideally through one database transaction/RPC called by the Edge Function. The `submission_key` and unique `assessment_id` link protect against retries.

## 5. Security requirements

### Public endpoint
- Use `verify_jwt = false` only because the assessment is a public experience; perform all application-level validation inside the function.
- Allow only the production Swayphics website origins for browser CORS. Treat CORS as a browser control, not as authentication.
- Accept only POST and OPTIONS; reject other methods.
- Enforce a strict request body size limit and field-length limits before model or database work.
- Validate the assessment version and every question/answer against server-side definitions. Ignore client-supplied scores and findings.
- Apply a honeypot and rate limiting. Hash or HMAC rate-limit identifiers before persistence; do not store raw IP addresses as rate-limit keys.
- Use a unique idempotency key and assessment/enquiry uniqueness to handle retries safely.
- Never return contact details, service-role errors, internal prompts, or raw database errors.
- Do not place a service-role key in browser code.

### Database
- Enable RLS on `business_assessments`.
- Permit authenticated Swayphics admins to read assessment records using `public.is_swayphics_admin()`.
- Do not grant public or anonymous SELECT access to assessment records.
- Grant only the operations required by the Edge Function to `service_role`.
- Keep enquiry/lead conversion behind an admin-authorised RPC.
- Prefer a hardened `search_path` and fully-qualified object names for any new `SECURITY DEFINER` function.
- Do not alter the existing enquiry conversion RPC to support this product unless a separate regression-tested change is explicitly approved.

### Rate limiter
The existing `check_and_increment_enquiry_rate_limit` RPC is a candidate for reuse, not yet approved as production-ready for this endpoint. Before relying on it:
1. test simultaneous first requests for the same identifier;
2. ensure the first-row insert path cannot produce an unhandled unique-constraint error;
3. use opaque hashed identifiers;
4. test both per-session/IP and contact-identifier limits;
5. define clear 429 responses and retry guidance.

If the existing RPC cannot safely support these cases, implement an atomic assessment-specific limiter rather than weakening the existing function.

## 6. Admin and lead workflow

1. Completed assessments without a contact request remain assessment records; they do not automatically become sales leads.
2. When a contact request is submitted, a linked `website_enquiries` record appears in the existing Enquiries area.
3. The enquiry card should show a `View assessment` action, including the key opportunities and evidence classifications.
4. An administrator explicitly chooses to convert the enquiry into a lead.
5. A dedicated admin-only conversion RPC locks the enquiry, checks whether it is already converted, links the assessment and handles possible duplicate leads.
6. A genuinely new lead should use source `Business Opportunity Finder`, status `new`, and no false `last_contacted_at` timestamp. A request for contact is not evidence that Swayphics has already contacted the business.
7. If a possible existing lead is found, do not silently change a `won` or `lost` status, overwrite its source, or merge a different business based only on a matching email. Present ambiguous matches for administrator review.
8. The admin lead profile should show linked assessment history. Existing proposal creation should use a snapshot so later assessments do not rewrite an already-created proposal's source evidence.

## 7. Evidence and recommendation contract

Every finding must contain:
- stable finding ID;
- short title and explanation;
- evidence classification: `self_reported`, `observed`, `inferred`, or `unverified`;
- source/reference (question ID or verified URL/inspection record);
- confidence level with an explicit basis;
- business implication;
- recommended next action;
- optional relevant Swayphics service.

Rules:
- A missed WhatsApp enquiry is self-reported unless separately verified.
- A missing website is only a finding after the respondent confirms it or an inspection verifies it.
- An inaccessible social profile or Google listing must be marked unverified, not treated as proof of absence.
- Do not invent revenue losses, conversion rates, customer counts, ROI, or guaranteed uplift.
- Separate what is already working from genuine opportunities.
- Do not recommend website development by default; recommend it only when supported by the diagnosis.
- The first release should use deterministic, versioned diagnostic rules. AI may later improve readability, but it must not introduce facts or change finding classifications.

## 8. Analytics

Track funnel events without recording raw answers or contact details in analytics:
- assessment started;
- assessment completed;
- report viewed;
- contact requested;
- enquiry reviewed;
- enquiry converted to lead;
- proposal created;
- lead won/lost.

Respect the site's analytics consent controls. Aggregate reporting should distinguish completion rate from contact-request rate and lead-conversion rate.

## 9. Required test matrix

### Submission and data integrity
- Valid assessment without a contact request creates one assessment and no enquiry.
- Valid assessment with a contact request creates one assessment and one linked enquiry.
- A retry with the same submission key does not create duplicates.
- A retry with the same assessment ID does not create duplicate enquiries.
- A second assessment for the same business creates a new historical record.
- Unknown assessment versions and question IDs are rejected.
- Invalid answer types, oversized payloads and overlong fields are rejected.
- User-supplied findings, scores and services are ignored/rejected.

### Security
- Requests from disallowed browser origins are rejected.
- Anonymous users cannot query the assessment table.
- Authenticated non-admins cannot query assessment records.
- Swayphics admins can view the records.
- Only the server function can write public submissions.
- The conversion RPC rejects unauthorised callers.
- No public endpoint returns a report from an assessment ID alone.
- Rate limits work under concurrent requests and do not expose raw identifiers.

### CRM regression
- Existing website enquiries still submit and notify admins.
- Existing website enquiry conversion remains unchanged.
- Assessment enquiry conversion sets the correct source.
- Assessment conversion does not falsely mark a lead as already contacted.
- Existing lead source and terminal status are preserved when a match exists.
- Repeating conversion does not create a second lead.
- Assessment history remains linked after lead conversion.
- Proposal snapshots preserve the correct assessment version.

### UX and accessibility
- One question per step, clear progress and adaptive branches.
- Skipping optional questions does not break report generation.
- Contact information is requested only after report value is shown.
- Mobile layout, keyboard navigation, focus handling and screen-reader labels pass.
- Reduced-motion preferences are respected.
- Loading, timeout, retry and submission-error states are tested.
- No success message is shown until the server confirms successful persistence.

## 10. Implementation sequence and approval gates

**Phase 1 — design baseline:** this specification and read-only production comparison.

**Phase 2 — isolated frontend:** build the public assessment experience in its own folder using Vanilla HTML, CSS and JavaScript, with clearly labelled local/mock data until the backend is approved.

**Phase 3 — database/backend:** after explicit approval, add the migration, RLS policies, submission function and admin conversion RPC. Reconcile migration history before applying anything to production.

**Phase 4 — evidence inspection:** add website, Google Business Profile and accessible public social inspection as separate modules with explicit success/failure states and stored evidence references.

**Phase 5 — CRM integration:** add the enquiry assessment viewer, safe conversion action, lead-profile assessment history and proposal snapshot integration.

**Phase 6 — verification and rollout:** run the test matrix, review function versions and migration state, validate mobile and desktop, then deploy with rollback steps.

### Items that remain unverified
- A full semantic reconciliation of all 108 live migrations against the repository and standalone SQL scripts.
- Whether the existing enquiry rate-limit RPC is safe under concurrent first use.
- Full end-to-end authenticated admin conversion in a browser session.
- Live production secrets, external inspection API permissions and deployed frontend/domain configuration.

**No production changes are authorised by this document.**
