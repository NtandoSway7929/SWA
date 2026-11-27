-- Owner-only Yoco test payment cleanup integration test.
-- Run only on a disposable local Supabase database after the Yoco migrations.
-- All fixtures are synthetic and the transaction is rolled back.

begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

select extensions.has_function(
    'public', 'admin_cleanup_yoco_test_payment',
    array['uuid','text','text'],
    'owner-only Yoco test payment cleanup RPC exists'
);
select extensions.ok(
    (select prosecdef from pg_proc
      where oid='public.admin_cleanup_yoco_test_payment(uuid,text,text)'::regprocedure),
    'cleanup RPC is SECURITY DEFINER'
);
select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
      where oid='public.admin_cleanup_yoco_test_payment(uuid,text,text)'::regprocedure),
    'cleanup RPC pins an empty search_path'
);
select extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.admin_cleanup_yoco_test_payment(uuid,text,text)',
        'execute'
    ),
    'authenticated role can invoke the owner-checked cleanup RPC'
);
select extensions.ok(
    not has_function_privilege(
        'anon',
        'public.admin_cleanup_yoco_test_payment(uuid,text,text)',
        'execute'
    ),
    'anonymous role cannot invoke cleanup'
);
select extensions.ok(
    not exists (
        select 1
          from pg_proc p,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid='public.admin_cleanup_yoco_test_payment(uuid,text,text)'::regprocedure
           and acl.grantee=0
           and acl.privilege_type='EXECUTE'
    ),
    'PUBLIC cannot invoke cleanup'
);
select extensions.ok(
    not has_table_privilege(
        'authenticated',
        'innerme_private.yoco_test_payment_cleanup_audit',
        'select'
    ),
    'authenticated users cannot read the private cleanup audit table directly'
);

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at
) values (
    '99999999-9999-4999-8999-999999999998',
    'authenticated',
    'authenticated',
    'yoco-cleanup-qa@example.invalid',
    '',
    now()
);

insert into public.admin_users (user_id, full_name, email, role, active)
values (
    '99999999-9999-4999-8999-999999999998',
    'Yoco Cleanup QA Owner',
    'yoco-cleanup-qa@example.invalid',
    'owner',
    true
);

insert into public.clients (id, business_name, contact_name, email)
values (
    '10000000-0000-4000-8000-000000000001',
    'Yoco Cleanup QA Client',
    'Test Contact',
    'yoco-cleanup-client@example.invalid'
);

insert into public.invoices (
    id, invoice_number, client_id, status, currency, subtotal, total,
    online_payment_enabled, online_payment_provider,
    partial_payment_enabled
) values (
    '10000000-0000-4000-8000-000000000002',
    'SWY-YOCO-CLEANUP-QA-0001',
    '10000000-0000-4000-8000-000000000001',
    'sent',
    'ZAR',
    100.00,
    100.00,
    true,
    'yoco',
    true
);

select innerme_private.create_yoco_payment_attempt(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    200,
    'yoco-cleanup-qa-idempotency-0001'
);

select innerme_private.attach_yoco_checkout(
    (select id from public.payment_attempts
      where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
    'yoco_cleanup_qa_checkout_0001',
    'https://payments.yoco.com/checkout/yoco-cleanup-qa-0001',
    now() + interval '1 hour'
);

select innerme_private.record_verified_yoco_webhook(
    'evt_yoco_cleanup_qa_payment_0001',
    'payment.succeeded',
    repeat('a', 64)
);

select innerme_private.settle_yoco_payment(
    (select id from public.payment_attempts
      where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
    (select id from public.payment_webhook_events
      where provider_event_id='evt_yoco_cleanup_qa_payment_0001'),
    'yoco_cleanup_qa_checkout_0001',
    200,
    'ZAR',
    'test',
    'yoco_cleanup_qa_transaction_0001'
);

-- Add non-Yoco records to prove provider classification is fail-closed.
insert into public.payments (
    id, client_id, invoice_id, amount, status, method, reference, paid_at,
    provider, currency
) values
(
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    1.00, 'paid', 'Card', 'PAYSTACK-CLEANUP-QA', current_date,
    'paystack', 'ZAR'
),
(
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    1.00, 'paid', 'EFT', 'MANUAL-CLEANUP-QA', current_date,
    null, 'ZAR'
);

-- Authenticated non-owner is rejected even with the correct confirmation.
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '99999999-9999-4999-8999-999999999997',
    true
);
select extensions.throws_ok(
    format(
        'select public.admin_cleanup_yoco_test_payment(%L::uuid, %L, %L)',
        (select payment_id::text from public.payment_attempts
          where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
        'DELETE TEST PAYMENT ' || (select payment_id::text from public.payment_attempts
          where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
        'Synthetic cleanup QA reason'
    ),
    '42501',
    'Active Swayphics owner access is required.',
    'non-owner cannot clean up a Yoco test payment'
);

-- Owner must type the exact payment ID.
select set_config(
    'request.jwt.claim.sub',
    '99999999-9999-4999-8999-999999999998',
    true
);
select extensions.throws_ok(
    format(
        'select public.admin_cleanup_yoco_test_payment(%L::uuid, %L, %L)',
        (select payment_id::text from public.payment_attempts
          where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
        'WRONG CONFIRMATION',
        'Synthetic cleanup QA reason'
    ),
    'P0001',
    format(
        'Confirmation must exactly match: DELETE TEST PAYMENT %s',
        (select payment_id::text from public.payment_attempts
          where idempotency_key='yoco-cleanup-qa-idempotency-0001')
    ),
    'owner cannot clean up without exact payment-ID confirmation'
);

select extensions.throws_ok(
    $$ select public.admin_cleanup_yoco_test_payment(
        '10000000-0000-4000-8000-000000000011',
        'DELETE TEST PAYMENT 10000000-0000-4000-8000-000000000011',
        'Synthetic cleanup QA reason'
    ) $$,
    'P0001',
    'Only Yoco test-mode payments are eligible. Paystack and manual payments are protected.',
    'Paystack live payment is rejected'
);
select extensions.throws_ok(
    $$ select public.admin_cleanup_yoco_test_payment(
        '10000000-0000-4000-8000-000000000012',
        'DELETE TEST PAYMENT 10000000-0000-4000-8000-000000000012',
        'Synthetic cleanup QA reason'
    ) $$,
    'P0001',
    'Only Yoco test-mode payments are eligible. Paystack and manual payments are protected.',
    'manual payment is rejected'
);

-- Successful cleanup is owner-only, transactional, and preserves the
-- provider attempt, webhook event, and complete receipt/delivery snapshots.
select extensions.ok(
    (
        public.admin_cleanup_yoco_test_payment(
            (select payment_id from public.payment_attempts
              where idempotency_key='yoco-cleanup-qa-idempotency-0001'),
            'DELETE TEST PAYMENT ' || (
                select payment_id::text from public.payment_attempts
                 where idempotency_key='yoco-cleanup-qa-idempotency-0001'
            ),
            'Synthetic Yoco test-payment cleanup QA'
        )->>'ok'
    ) = 'true',
    'owner can clean up a fully verified Yoco test payment'
);
reset role;

select extensions.ok(
    not exists (
        select 1 from public.payments
         where id='10000000-0000-4000-8000-000000000011'
    ) is false,
    'Paystack payment remains untouched'
);
select extensions.ok(
    exists (
        select 1 from public.payments
         where id='10000000-0000-4000-8000-000000000012'
    ),
    'manual payment remains untouched'
);
select extensions.ok(
    not exists (
        select 1 from public.payments p
        join public.payment_attempts pa on pa.payment_id=p.id
        where pa.idempotency_key='yoco-cleanup-qa-idempotency-0001'
    ),
    'Yoco test payment ledger row is removed'
);
select extensions.ok(
    exists (
        select 1 from public.payment_attempts pa
         where pa.idempotency_key='yoco-cleanup-qa-idempotency-0001'
           and pa.status='succeeded'
           and pa.payment_id is null
    ),
    'successful provider attempt is retained and detached from the removed ledger row'
);
select extensions.ok(
    exists (
        select 1 from public.payment_webhook_events e
        join public.payment_attempts pa on pa.id=e.payment_attempt_id
         where pa.idempotency_key='yoco-cleanup-qa-idempotency-0001'
           and e.provider_event_id='evt_yoco_cleanup_qa_payment_0001'
           and e.signature_verified is true
    ),
    'verified provider webhook event is retained'
);
select extensions.ok(
    exists (
        select 1 from innerme_private.yoco_test_payment_cleanup_audit a
         where a.payment_attempt_id=(
             select id from public.payment_attempts
              where idempotency_key='yoco-cleanup-qa-idempotency-0001'
         )
           and a.payment_snapshot ? 'provider'
           and a.receipt_snapshot ? 'receipt_number'
           and jsonb_array_length(a.webhook_event_snapshots) > 0
    ),
    'private cleanup audit retains payment, receipt, and webhook snapshots'
);

select * from extensions.finish();
rollback;
