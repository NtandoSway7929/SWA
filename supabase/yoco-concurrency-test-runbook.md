# Yoco concurrency and recovery test runbook

**Environment restriction:** disposable local PostgreSQL/Supabase database only. Never run this exercise against production or a connected production Supabase project. It creates committed fixtures and immutable financial ledger entries; reset the disposable database after the exercise.

## Prerequisites

- Complete Swayphics base schema.
- Existing invoice/business-flow schema and functions, including `supabase/swayphics-invoicing.sql` and `supabase/swayphics-business-flow.sql`.
- Yoco migrations 001–005 applied in order.
- PostgreSQL client `psql`.
- Two independent terminal sessions connected to the same disposable database.

Set `LOCAL_DB_URL` in both terminals. Do not put a production connection string in this variable.

## 1. Create isolated fixtures

Run once:

```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/202611110007_yoco_concurrency_fixture.sql
```

Copy the IDs printed in the `RACE_FIXTURE` NOTICE:
- `attempt_id`
- `payment_event_id`
- `refund_event_a`
- `refund_event_b`

The fixture creates a ZAR 100 invoice and a ZAR 60 payment attempt, plus two pre-associated refund events. The events are marked as already signature-verified by the fixture RPC; this isolates database concurrency and does not test HMAC verification.

## 2. Concurrent settlement replay

Replace the four placeholders below with the fixture values. Start both commands as close together as possible, one in each terminal:

**Session A**
```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "select innerme_private.settle_yoco_payment('<ATTEMPT_ID>'::uuid, '<PAYMENT_EVENT_ID>'::uuid, 'yoco_test_race_checkout_01', 6000, 'ZAR', 'test', 'yoco_test_race_txn_01');"
```

**Session B**
```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "select innerme_private.settle_yoco_payment('<ATTEMPT_ID>'::uuid, '<PAYMENT_EVENT_ID>'::uuid, 'yoco_test_race_checkout_01', 6000, 'ZAR', 'test', 'yoco_test_race_txn_01');"
```

Expected:
- Both calls return `settled=true`.
- Exactly one returns `duplicate=false`; the other returns `duplicate=true`.
- Exactly one Yoco payment and one receipt exist for the attempt.
- Attempt status is `succeeded`; event status is `processed`.

Verify:

```sql
select a.status as attempt_status, a.payment_id,
       count(distinct p.id) as payment_rows,
       count(distinct r.id) as receipt_rows
from public.payment_attempts a
left join public.payments p on p.id = a.payment_id
left join public.payment_receipts r on r.payment_id = p.id
where a.id = '<ATTEMPT_ID>'::uuid
group by a.status, a.payment_id;
```

## 3. Competing partial refunds

Get the payment ID returned by settlement (or from `payment_attempts.payment_id`). Start both calls in separate sessions:

**Session A**
```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "select innerme_private.record_yoco_refund_success('<REFUND_EVENT_A>'::uuid, '<PAYMENT_ID>'::uuid, 'yoco_test_race_refund_a', 4000, 'ZAR');"
```

**Session B**
```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "select innerme_private.record_yoco_refund_success('<REFUND_EVENT_B>'::uuid, '<PAYMENT_ID>'::uuid, 'yoco_test_race_refund_b', 4000, 'ZAR');"
```

Each event represents a ZAR 40 refund against the same ZAR 60 payment. Expected:
- Exactly one refund returns `recorded=true`.
- The other returns `recorded=false, requires_review=true` with `refund_exceeds_payment`.
- Exactly one successful refund row exists, totalling ZAR 40.
- Invoice net paid is ZAR 20 and outstanding is ZAR 80.
- No deadlock or unhandled transaction failure occurs.

Verify:

```sql
select count(*) as successful_refunds, coalesce(sum(amount), 0) as refunded
from public.payment_refunds
where payment_id = '<PAYMENT_ID>'::uuid
  and provider = 'yoco' and environment = 'test' and status = 'succeeded';

select amount_paid, amount_outstanding, status
from public.invoices
where id = (select invoice_id from public.payments where id = '<PAYMENT_ID>'::uuid);
```

## 4. Concurrent checkout-attempt idempotency

After resetting the disposable database and recreating fixtures (or use a separate disposable invoice/client), run the following in two sessions with the same invoice ID, client ID, amount and idempotency key:

```sql
select innerme_private.create_yoco_payment_attempt(
  '<INVOICE_ID>'::uuid, '<CLIENT_ID>'::uuid, 6000, 'same-concurrent-key-001'
);
```

Expected: both callers receive the same `attempt_id`; exactly one attempt row exists for that provider/environment/client/idempotency key. A second call with the same key but a different amount or invoice must be rejected.

## 5. Checkout interruption/retry boundary

The database-level test above cannot prove behaviour across a process crash between Yoco creating a hosted checkout and the application persisting the returned checkout ID. Verify this separately in Yoco sandbox:
1. Submit checkout creation with a stable idempotency key.
2. Simulate a timeout after the provider accepts the request but before the application receives/persists the response.
3. Retry with the same key.
4. Confirm whether Yoco returns the original checkout or creates another one, and verify the local attempt remains uniquely associated.
5. If provider idempotency cannot be confirmed for this endpoint, do not automatically create another checkout; route the attempt to reconciliation/manual review.

No live credentials or live checkout calls are permitted during this preparation stage.

## Acceptance record

Record for each race: database version, migration revision, both session outputs, row-count queries, invoice balance, elapsed time, and any SQLSTATE/deadlock. Repeat each race at least 20 times on a disposable database before treating it as stable. The expected outcomes above are test criteria, not results already observed.

## Known scope limits

- This runbook is a reproducible manual two-session protocol, not an automated concurrency test runner.
- The fixture's verified events bypass the Edge Function's signature-verification step.
- It does not test Yoco's sandbox idempotency semantics, webhook delivery retries over HTTP, or network/process crashes.
- Do not mark concurrency QA as passed until both-session tests have been executed and their outputs reviewed.
