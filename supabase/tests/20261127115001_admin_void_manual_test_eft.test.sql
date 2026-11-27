-- Owner-only, append-only void of the single R700 manual EFT test transaction.
-- All fixtures use fixed IDs because the production RPC deliberately targets one record.
-- Run only on the isolated Yoco disposable database; this file rolls back all fixtures.

begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.has_table(
    'innerme_private',
    'manual_test_eft_void_audit',
    'private manual EFT test-void audit table exists'
);
select extensions.ok(
    (select relrowsecurity from pg_class
      where oid='innerme_private.manual_test_eft_void_audit'::regclass),
    'RLS is enabled on the private manual EFT void audit table'
);
select extensions.ok(
    not has_table_privilege('authenticated','innerme_private.manual_test_eft_void_audit','select')
    and not has_table_privilege('service_role','innerme_private.manual_test_eft_void_audit','select'),
    'authenticated and service roles cannot directly read the private audit table'
);
select extensions.has_function(
    'public','admin_void_manual_test_eft',array['uuid','text','text'],
    'owner-only exact-ID manual EFT void RPC exists'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
      where oid='public.admin_void_manual_test_eft(uuid,text,text)'::regprocedure),
    'manual EFT void RPC is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    has_function_privilege('authenticated','public.admin_void_manual_test_eft(uuid,text,text)','execute')
    and not has_function_privilege('anon','public.admin_void_manual_test_eft(uuid,text,text)','execute')
    and not exists (
        select 1 from pg_proc p,
             lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
         where p.oid='public.admin_void_manual_test_eft(uuid,text,text)'::regprocedure
           and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),
    'manual EFT void RPC is callable only by authenticated users subject to the owner check'
);
select extensions.has_function(
    'public','admin_get_manual_test_eft_void_status',array[]::text[],
    'owner-only manual EFT void status RPC exists'
);
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
      where oid='public.admin_get_manual_test_eft_void_status()'::regprocedure),
    'manual EFT void status RPC pins an empty search_path'
);
select extensions.ok(
    (select pg_get_constraintdef(oid) like '%voided_test%'
       from pg_constraint where conrelid='public.payments'::regclass and conname='payments_status_check'),
    'payments status constraint permits the explicit voided_test state'
);
select extensions.ok(
    exists (
        select 1 from information_schema.columns
         where table_schema='public' and table_name='payment_receipts'
           and column_name='voided_at'
    )
    and exists (
        select 1 from information_schema.columns
         where table_schema='public' and table_name='payment_receipts'
           and column_name='void_reason'
    ),
    'issued receipts have explicit void metadata'
);
select extensions.ok(
    (select pg_get_constraintdef(oid) like '%voided_test%'
       from pg_constraint where conrelid='public.bank_transfer_submissions'::regclass
         and conname='bank_transfer_submissions_status_check'),
    'bank-transfer submission status constraint permits voided_test'
);

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
    '99999999-9999-4999-8999-999999999996',
    'authenticated','authenticated',
    'manual-eft-void-qa@example.invalid','',now(),
    '{}'::jsonb,'{}'::jsonb,now(),now()
);

insert into public.admin_users (user_id,full_name,email,role,active)
values (
    '99999999-9999-4999-8999-999999999996',
    'Manual EFT Void QA Owner',
    'manual-eft-void-qa@example.invalid',
    'owner',true
);

insert into public.clients (id,business_name,contact_name,email)
values (
    'f8ce9e4a-127f-404b-8741-130d3d7e085c',
    'Manual EFT Void QA Client','Test Contact','manual-eft-client@example.invalid'
);

insert into public.invoices (
    id,invoice_number,client_id,issue_date,due_date,status,currency,
    subtotal,total,archived,archived_at,online_payment_enabled,partial_payment_enabled
) values (
    '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb',
    'SWY-2026-0010',
    'f8ce9e4a-127f-404b-8741-130d3d7e085c',
    date '2026-11-13',
    date '2026-11-18',
    'sent','ZAR',700.00,700.00,true,now(),true,false
);

insert into public.payments (
    id,client_id,invoice_id,amount,status,method,reference,paid_at,
    provider,currency,notes
) values (
    '4e8761b0-feec-429a-a690-7085b59aedcd',
    'f8ce9e4a-127f-404b-8741-130d3d7e085c',
    '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb',
    700.00,'paid','EFT','SWY',now(),null,'ZAR',
    'Bank transfer proof reviewed and payment manually confirmed by an active Swayphics administrator.'
);

insert into public.payment_receipts (
    id,payment_id,receipt_number,issued_at,snapshot
) values (
    'f5c08942-97d1-4c55-9cd5-f7e14557b325',
    '4e8761b0-feec-429a-a690-7085b59aedcd',
    'SW-RCPT-2026-000001',
    now(),
    '{"amount":700,"currency":"ZAR","method":"EFT","invoice_number":"SWY-2026-0010"}'::jsonb
);
 
update public.payment_receipt_deliveries
   set status = 'sent',
       recipient_email = 'swayphics@gmail.com',
       provider_message_id = 'manual-eft-void-test-message',
       pdf_storage_path = '2026/SW-RCPT-2026-000001.pdf',
       attempt_count = 2,
       last_attempt_at = now(),
       sent_at = now(),
       updated_at = now()
 where receipt_id = 'f5c08942-97d1-4c55-9cd5-f7e14557b325';

insert into public.payment_receipt_delivery_attempts (
    receipt_id,status,recipient_email,provider_message_id,attempted_at
) values
    ('f5c08942-97d1-4c55-9cd5-f7e14557b325','sent','swayphics@gmail.com','manual-eft-void-test-message',now()-interval '2 minutes'),
    ('f5c08942-97d1-4c55-9cd5-f7e14557b325','sent','swayphics@gmail.com','manual-eft-void-test-message',now()-interval '1 minute');

insert into public.payment_receipt_provider_events (
    event_id,receipt_id,event_type,provider_message_id,event_created_at
) values (
    'manual-eft-void-test-delivered-event',
    'f5c08942-97d1-4c55-9cd5-f7e14557b325',
    'email.delivered',
    'manual-eft-void-test-message',
    now()
);

insert into public.bank_transfer_submissions (
    id,invoice_id,client_id,amount,bank_reference,proof_storage_path,
    proof_file_name,proof_mime_type,proof_size_bytes,status,payment_id,
    submitted_at,reviewed_at,reviewed_by
) values (
    '1eca46ef-3c9e-4e04-a72e-907431ad7bc6',
    '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb',
    'f8ce9e4a-127f-404b-8741-130d3d7e085c',
    700.00,'SWY',
    'f8ce9e4a-127f-404b-8741-130d3d7e085c/1eca46ef-3c9e-4e04-a72e-907431ad7bc6/proof.jpg',
    'proof.jpg','image/jpeg',1024,
    'approved','4e8761b0-feec-429a-a690-7085b59aedcd',
    now(),now(),'99999999-9999-4999-8999-999999999996'
);

select extensions.ok(
    (select amount_paid=700 and amount_outstanding=0 and status='paid'
       from public.invoices where id='19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'),
    'fixture invoice initially reflects the synthetic paid EFT'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999997',true);
select extensions.throws_ok(
    'select public.admin_get_manual_test_eft_void_status()',
    '42501','Active Swayphics owner access is required.',
    'non-owner cannot inspect the manual test EFT record'
);
select extensions.throws_ok(
    $$ select public.admin_void_manual_test_eft(
        '4e8761b0-feec-429a-a690-7085b59aedcd',
        'VOID TEST EFT PAYMENT 4e8761b0-feec-429a-a690-7085b59aedcd',
        'QA confirms no funds received'
    ) $$,
    '42501','Active Swayphics owner access is required.',
    'non-owner cannot void the manual EFT test payment'
);

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999996',true);
select extensions.throws_ok(
    $$ select public.admin_void_manual_test_eft(
        '4e8761b0-feec-429a-a690-7085b59aedcd',
        'WRONG CONFIRMATION',
        'QA confirms no funds received'
    ) $$,
    'P0001',
    'Confirmation must exactly match: VOID TEST EFT PAYMENT 4e8761b0-feec-429a-a690-7085b59aedcd',
    'owner must provide the exact fixed payment-ID confirmation'
);

select extensions.ok(
    (
        public.admin_void_manual_test_eft(
            '4e8761b0-feec-429a-a690-7085b59aedcd',
            'VOID TEST EFT PAYMENT 4e8761b0-feec-429a-a690-7085b59aedcd',
            'Owner-confirmed entire EFT transaction was a test; no funds were received.'
        )->>'ok'
    ) = 'true',
    'owner can void the specific R700 test EFT transaction'
);

reset role;

select extensions.ok(
    (select status='voided_test' and notes like '%VOIDED TEST EFT%'
       from public.payments where id='4e8761b0-feec-429a-a690-7085b59aedcd'),
    'payment remains in the ledger but is marked voided_test with an explicit note'
);
select extensions.ok(
    (select amount_paid=0 and amount_outstanding=700 and status<>'paid' and archived
       from public.invoices where id='19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'),
    'invoice balance is recalculated to the full R700 outstanding while archive status is preserved'
);
select extensions.ok(
    (select voided_at is not null and voided_by='99999999-9999-4999-8999-999999999996'
       and void_reason is not null
       from public.payment_receipts where id='f5c08942-97d1-4c55-9cd5-f7e14557b325'),
    'original receipt is retained and explicitly voided'
);
select extensions.ok(
    (select status='voided_test' and payment_id='4e8761b0-feec-429a-a690-7085b59aedcd'
       and proof_storage_path='f8ce9e4a-127f-404b-8741-130d3d7e085c/1eca46ef-3c9e-4e04-a72e-907431ad7bc6/proof.jpg'
       and reviewed_at is not null and reviewed_by='99999999-9999-4999-8999-999999999996'
       and voided_at is not null
       from public.bank_transfer_submissions where id='1eca46ef-3c9e-4e04-a72e-907431ad7bc6'),
    'bank transfer approval, proof path and reviewer history are retained on the voided test submission'
);
select extensions.throws_ok(
    $cmd$ update public.payments
          set notes = coalesce(notes,'') || ' attempted edit'
        where id = '4e8761b0-feec-429a-a690-7085b59aedcd' $cmd$,
    '55000',
    'Voided test payments are immutable and cannot be reactivated or edited.',
    'a voided test payment cannot be edited or restored to paid'
);
select extensions.throws_ok(
    $cmd$ update public.bank_transfer_submissions
          set status = 'approved'
        where id = '1eca46ef-3c9e-4e04-a72e-907431ad7bc6' $cmd$,
    '55000',
    'Voided test bank-transfer submissions are immutable.',
    'a voided test bank-transfer submission cannot be re-approved'
);

select extensions.ok(
    exists (
        select 1 from innerme_private.manual_test_eft_void_audit a
         where a.original_payment_id='4e8761b0-feec-429a-a690-7085b59aedcd'
           and a.payment_snapshot->>'status'='paid'
           and (a.invoice_snapshot->>'amount_paid')::numeric=700
           and a.receipt_snapshot->>'receipt_number'='SW-RCPT-2026-000001'
           and a.bank_transfer_snapshot->>'status'='approved'
           and a.proof_storage_path='f8ce9e4a-127f-404b-8741-130d3d7e085c/1eca46ef-3c9e-4e04-a72e-907431ad7bc6/proof.jpg'
           and jsonb_array_length(a.receipt_delivery_snapshot->'deliveries')=1
           and a.receipt_delivery_snapshot->'deliveries'->0->>'provider_message_id'='manual-eft-void-test-message'
           and a.receipt_delivery_snapshot->'deliveries'->0->>'pdf_storage_path'='2026/SW-RCPT-2026-000001.pdf'
           and jsonb_array_length(a.receipt_delivery_snapshot->'delivery_attempts')=2
           and jsonb_array_length(a.receipt_delivery_snapshot->'provider_events')=1
    ),
    'private audit preserves pre-void payment, invoice, receipt, approved transfer, proof path and delivery snapshot'
);
select set_config(
    'test.manual_test_eft_void_audit_id',
    (select id::text from innerme_private.manual_test_eft_void_audit
      where original_payment_id='4e8761b0-feec-429a-a690-7085b59aedcd'),
    true
);
reset role;

select extensions.throws_ok(
    format(
        'update innerme_private.manual_test_eft_void_audit set reason = %L where id = %L::uuid',
        'tampered audit reason',
        current_setting('test.manual_test_eft_void_audit_id')
    ),
    '55000',
    'Manual test EFT void audit records are immutable.',
    'private void audit snapshots cannot be changed'
);

select extensions.ok(
    (select count(*)=1 from public.payment_receipts
      where id='f5c08942-97d1-4c55-9cd5-f7e14557b325'),
    'original receipt row is retained rather than deleted'
);
select extensions.ok(
    (select count(*)=1 from public.bank_transfer_submissions
      where id='1eca46ef-3c9e-4e04-a72e-907431ad7bc6'),
    'original bank-transfer submission and its proof reference are retained'
);

select * from extensions.finish();
rollback;
