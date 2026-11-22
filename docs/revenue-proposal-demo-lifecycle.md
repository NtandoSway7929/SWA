# Proposal demo lifecycle

## Storage and permission findings

The production metadata inspected for this change shows that `lead_proposals` belongs to `leads` and currently stores proposal text and approval state, with no demo version or share fields. `swayphics-client-files` is private, but its current storage policies let active admins read, upload, update, and delete its objects. The `portfolio` bucket is public. Neither bucket is a safe fit for immutable lead-specific demos: the client-files bucket is broader than this access model, and public portfolio URLs cannot be revoked.

The migration therefore proposes a separate private `swayphics-proposal-demos` bucket. It grants active admins read access and insert-only uploads for draft versions. It adds no update/delete storage policy. Objects use the version UUID as a path boundary. Published version metadata is locked after a one-way draft-to-published transition, and lead/proposal deletion is restricted while demo history exists.

## Version and sharing model

- `proposal_demo_versions` links every revision to both the exact `lead_id` and `proposal_id`. An insert trigger checks the association and allocates a serialized version number. A version may contain a file, a static site, or both.
- Admin-only Edge Function actions create a draft, verify its required private objects, and publish it. The Storage insert policy accepts uploads only under that draft's UUID folder. Publishing closes that upload path.
- `proposal_demo_shares` stores a SHA-256 token hash, one target (`file` or `static_site`), an explicit expiry timestamp, and revocation metadata. The raw 256-bit token is returned once at issue and is never stored in the database.
- Every share request is checked server-side for token, expiry, revocation, publication state, and target scope. A file share redirects to a signed private-object URL valid for 60 seconds. A static-site share streams each asset through the gateway after checking the share again, applies a restrictive CSP sandbox, and keeps the private source objects inaccessible to anonymous Storage requests.
- The static-site gateway serves self-contained static previews. It blocks external scripts, API calls, forms, framing, and top-level navigation. A preview that depends on external resources or live APIs must be packaged/self-hosted or use a separately reviewed hosting integration.

Supabase signed Storage URLs remain usable until their expiry, even after a share is revoked. Revocation therefore blocks future share redemptions immediately; a file URL already issued can remain usable for up to the 60-second URL lifetime. Static-site requests check revocation on every asset request.

## Expiry and retention decisions

Every share requires an admin-supplied expiry; the implementation sets no default duration or maximum. The proposed 30-day share expiry is not encoded. No 90-day recovery timer, 24-month audit purge, retention job, or automatic object cleanup is included. Published version/share metadata is retained indefinitely by this migration until a retention policy is approved. Lead/proposal deletion is blocked while versions exist to avoid silently erasing that history.

## Activation and remaining work

The SQL is a review-only migration and has not been applied. The Edge Function is not deployed. Before rollout, review the proposed delete restriction and retention behavior, select a share-expiry policy, confirm the allowed upload size/type limits, and test the deployment against an isolated business-schema project. A dashboard manager for draft uploads, publishing, share creation and revocation can then call these endpoints without exposing the service-role key.

The implementation is intentionally limited to the migration, server-side capability flow, provider-free tests, and CI validation. No live record, bucket, policy, secret, or function was changed.
