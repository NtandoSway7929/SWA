# Yoco client payments: webhook concurrency-control design

Target branch: `feature/yoco-client-payments`

**Stage:** 1.42 design and implementation gate  
**Status:** Design documented; runtime concurrency control is not implemented by this document.

## Problem

Stage 1.41 resumes duplicate events in `received`, `processing` and `failed_retryable`. The current handler permits every delivery that observes `processing` to continue. Two concurrent deliveries of the same provider event can therefore both perform lookups and invoke the financial RPCs.

The settlement and refund RPCs are intended to be idempotent and row-locked. That is an important financial safeguard, but it is not an exclusive event-processing claim. In particular, it does not prevent duplicate non-financial work, conflicting event-state writes, or a stale worker from writing after a newer retry has taken ownership.

## Required design

Use a database-backed, time-limited processing lease. Do not use an in-memory mutex: Edge Function instances are distributed and ephemeral.

### Schema additions

Add nullable columns to `public.payment_webhook_events`:

- `processing_lease_token uuid`
- `processing_lease_expires_at timestamptz`

Add a check constraint requiring both values to be null or both non-null. Add an index supporting operational inspection of expired leases.

### Atomic claim RPC

Add a private `innerme_private.claim_yoco_webhook_event(event_id uuid, lease_seconds integer)` function and a narrow `public.yoco_claim_webhook_event` service-role-only wrapper.

The claim must run in one transaction and lock the event row with `FOR UPDATE`. It may issue a fresh random lease token only when:

- status is `received` or `failed_retryable`; or
- status is `processing` and the prior lease has expired.

A live lease must not be stolen. Terminal states (`processed`, `requires_review`, `rejected`) must never be claimed. Unknown states must fail closed. Bound lease duration in SQL (recommended initial value: 120 seconds); callers must not choose an arbitrary long lease.

Return a structured result containing `claimed`, `processing_status`, and the lease token only to the successful claimant. Do not return the token for an unclaimed event.

### Fenced state transitions

Every event mutation made by the Edge Function after claim must include both event ID and lease token in its predicate. A stale worker whose lease was replaced must update zero rows and must not overwrite the newer worker's state.

Terminal transitions must clear both lease columns. Retryable failures may clear the lease so provider redelivery can claim immediately, or retain it until expiry; choose one policy consistently and test it. Prefer clearing the lease on known retryable exits, while allowing process crashes to recover through expiry.

The event-recording RPC must continue to detect event-ID/body collisions before any claim. A changed body for an existing provider event must remain a review case and must not obtain a processing lease.

### Handler behaviour

1. Verify the raw-body signature.
2. Persist/resolve the event and validate event identity/body digest.
3. Return immediately for terminal states.
4. Atomically claim the event.
5. If another worker owns a live lease, return HTTP 503 (retryable) rather than acknowledge work that is still in progress.
6. Process only with the returned lease token.
7. Fence all event-state writes with the token.
8. On success, financial RPCs must atomically mark the event terminal and clear its lease, or a token-checked finalization RPC must do so.
9. On retryable error, release the lease using a token-checked operation. If the process crashes, lease expiry permits recovery.

Do not mark a webhook processed merely because the provider has been acknowledged. A 2xx response is appropriate only after durable terminal processing or a deliberate durable review outcome.

## Required tests before implementation is accepted

### PostgreSQL transaction tests

- Two sessions claim the same `received` event simultaneously: exactly one succeeds.
- Second session cannot claim while first lease is live.
- Expired lease can be reclaimed with a new token.
- Old token cannot update or release a reclaimed event.
- Terminal event cannot be claimed.
- Unknown status fails closed.
- Event ID collision with changed digest cannot claim.
- A failed transaction rolls back the lease claim.
- Lease columns are cleared on terminal transitions.
- Service-role-only grants; no anon/authenticated execution.

### Edge Function tests

- Claim denied because another worker owns the lease: no payment/refund RPC is called.
- Claim RPC outage: HTTP 503.
- State write with stale token affects zero rows and returns retryable failure.
- Settlement succeeds once under two concurrent deliveries.
- Refund succeeds once under two concurrent deliveries.
- A worker crash after claim is recovered only after lease expiry.
- A stale worker cannot overwrite the reclaimed worker's terminal result.

### Runtime verification

Deno tests and PostgreSQL tests must run against a disposable local environment. Then perform concurrent signed test-mode webhook deliveries against a Yoco sandbox. None of these environments or credentials are currently available in this work session.

## Important implementation constraint

Do not simply add a lease token to the existing generic `updateWebhookEvent` helper and assume this is sufficient. The settlement and refund SQL functions also update event state. Their signatures and transaction logic must be changed to validate the current lease token and clear the lease atomically with ledger mutation. Payment-failure and review-state transitions need the same fencing.

## Release gate

Stage 1.42 is not complete until the migration, RPC boundary, Edge Function claim/fencing changes, SQL concurrency tests, Edge tests, and disposable PostgreSQL execution are all complete. No production migration, secret configuration, webhook registration, live payment or deployment is authorised.
