-- Bank transfer submission security and settlement integration tests.
-- Run only against the disposable Supabase schema used by the Yoco QA workflow.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.has_table('public','bank_transfer_submissions','bank transfer submissions table exists');
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.bank_transfer_submissions'::regclass),
  'RLS is enabled on the bank transfer submissions table'
);
select extensions.ok(
  (select public is false from storage.buckets where id='swayphics-payment-proofs'),
  'payment proof storage bucket is private'
);
select extensions.ok(
  not has_table_privilege('anon','public.bank_transfer_submissions','select')
  and not has_table_privilege('authenticated','public.bank_transfer_submissions','select'),
  'portal and authenticated roles cannot query bank transfer submissions directly'
);
select extensions.ok(
  not has_function_privilege('anon','public.admin_approve_bank_transfer_submission(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.admin_approve_bank_transfer_submission(uuid,uuid)','execute'),
  'public and authenticated roles cannot execute the approval RPC'
);
select extensions.ok(
  has_function_privilege('service_role','public.admin_approve_bank_transfer_submission(uuid,uuid)','execute'),
  'service role can invoke the protected approval RPC'
);
select extensions.ok(
  not has_function_privilege('anon','public.admin_reject_bank_transfer_submission(uuid,uuid,text)','execute')
  and has_function_privilege('service_role','public.admin_reject_bank_transfer_submission(uuid,uuid,text)','execute'),
  'only the service role can invoke the protected rejection RPC'
);
select extensions.ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid='public.admin_approve_bank_transfer_submission(uuid,uuid)'::regprocedure),
  'approval wrapper uses SECURITY DEFINER and an empty search path'
);
select extensions.ok(
  exists (select 1 from pg_indexes where schemaname='public' and indexname='bank_transfer_submissions_reference_uidx'),
  'duplicate bank references are constrained while a submission is pending or approved'
);

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'ASSERTION FAILED: %', p_message; end if;
end;
$$;

create or replace function pg_temp.expect_error(p_statement text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    return;
  end;
  raise exception 'ASSERTION FAILED: expected an error: %', p_message;
end;
$$;

do $$
declare
  v_admin_id uuid := gen_random_uuid();
  v_client_id uuid;
  v_invoice_id uuid;
  v_reject_invoice_id uuid;
  v_submission_id uuid;
  v_overpayment_submission_id uuid;
  v_reject_submission_id uuid;
  v_approved jsonb;
  v_duplicate jsonb;
  v_payment_id uuid;
  v_receipt_count integer;
  v_payment_count integer;
  v_outstanding numeric(12,2);
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    v_admin_id, 'authenticated', 'authenticated',
    'bank-transfer-review@example.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.admin_users (user_id, full_name, email, role, active)
  values (v_admin_id, 'Bank Transfer Reviewer', 'bank-transfer-review@example.invalid', 'owner', true);

  insert into public.clients (business_name, contact_name, email)
  values ('Bank Transfer Test Client', 'Test Contact', 'bank-transfer-client@example.invalid')
  returning id into v_client_id;

  insert into public.invoices (client_id, status, currency, subtotal, total)
  values (v_client_id, 'sent', 'ZAR', 100, 100)
  returning id into v_invoice_id;

  insert into public.bank_transfer_submissions (
    invoice_id, client_id, amount, bank_reference, proof_storage_path,
    proof_file_name, proof_mime_type, proof_size_bytes
  )
  values (
    v_invoice_id, v_client_id, 40, 'BANK-TEST-REF-001',
    v_client_id::text || '/' || gen_random_uuid()::text || '/proof.pdf',
    'proof.pdf', 'application/pdf', 128
  )
  returning id into v_submission_id;

  v_approved := innerme_private.approve_bank_transfer_submission(v_submission_id, v_admin_id);
  v_payment_id := (v_approved->>'payment_id')::uuid;

  perform pg_temp.assert_true((v_approved->>'ok')::boolean, 'bank transfer approval succeeds');
  perform pg_temp.assert_true(v_payment_id is not null, 'approval creates a payment ledger row');
  perform pg_temp.assert_true(exists (
    select 1 from public.payments p
    where p.id = v_payment_id and p.invoice_id = v_invoice_id
      and p.method = 'EFT' and p.status = 'paid' and p.provider is null
      and p.amount = 40 and p.reference = 'BANK-TEST-REF-001'
  ), 'approved transfer is recorded as a paid EFT ledger transaction');
  perform pg_temp.assert_true(exists (
    select 1 from public.payment_receipts r
    where r.payment_id = v_payment_id and r.snapshot->>'method' = 'EFT'
      and r.snapshot->>'invoice_id' = v_invoice_id::text
  ), 'approval issues a receipt tied to the EFT payment and invoice');
  perform pg_temp.assert_true((select status = 'approved' and payment_id = v_payment_id
      and reviewed_by = v_admin_id and reviewed_at is not null
    from public.bank_transfer_submissions where id = v_submission_id),
    'submission is linked to the confirmed payment and administrator review');

  select amount_outstanding into v_outstanding from public.invoices where id = v_invoice_id;
  perform pg_temp.assert_true(v_outstanding = 60, 'invoice balance is recalculated from the EFT ledger transaction');

  v_duplicate := innerme_private.approve_bank_transfer_submission(v_submission_id, v_admin_id);
  perform pg_temp.assert_true((v_duplicate->>'duplicate')::boolean, 'repeated approval is idempotent');
  select count(*) into v_receipt_count from public.payment_receipts where payment_id = v_payment_id;
  select count(*) into v_payment_count from public.payments where invoice_id = v_invoice_id and method = 'EFT';
  perform pg_temp.assert_true(v_receipt_count = 1 and v_payment_count = 1, 'repeated approval does not duplicate the payment or receipt');

  insert into public.bank_transfer_submissions (
    invoice_id, client_id, amount, bank_reference, proof_storage_path,
    proof_file_name, proof_mime_type, proof_size_bytes
  )
  values (
    v_invoice_id, v_client_id, 70, 'BANK-TEST-REF-OVER',
    v_client_id::text || '/' || gen_random_uuid()::text || '/proof.pdf',
    'proof.pdf', 'application/pdf', 128
  )
  returning id into v_overpayment_submission_id;

  perform pg_temp.expect_error(
    format('select innerme_private.approve_bank_transfer_submission(%L::uuid,%L::uuid)',
      v_overpayment_submission_id, v_admin_id),
    'overpayment is rejected after locking and rechecking the invoice'
  );
  perform pg_temp.assert_true((select status='pending_review' and payment_id is null
      from public.bank_transfer_submissions where id=v_overpayment_submission_id),
      'overpayment rejection keeps the submission pending and creates no payment');

  insert into public.invoices (client_id, status, currency, subtotal, total)
  values (v_client_id, 'sent', 'ZAR', 75, 75)
  returning id into v_reject_invoice_id;

  insert into public.bank_transfer_submissions (
    invoice_id, client_id, amount, bank_reference, proof_storage_path,
    proof_file_name, proof_mime_type, proof_size_bytes
  )
  values (
    v_reject_invoice_id, v_client_id, 75, 'BANK-TEST-REF-REJECT',
    v_client_id::text || '/' || gen_random_uuid()::text || '/proof.pdf',
    'proof.pdf', 'application/pdf', 128
  )
  returning id into v_reject_submission_id;

  perform innerme_private.reject_bank_transfer_submission(
    v_reject_submission_id, v_admin_id, 'Bank statement does not show this deposit.'
  );
  perform pg_temp.assert_true((select status='rejected' and rejection_reason is not null
      and reviewed_by=v_admin_id and reviewed_at is not null
    from public.bank_transfer_submissions where id=v_reject_submission_id),
    'rejection stores the administrator, timestamp and reason');
  perform pg_temp.assert_true((select amount_outstanding=75 from public.invoices where id=v_reject_invoice_id),
    'rejection does not alter the invoice balance');
  perform pg_temp.assert_true(not exists (
    select 1 from public.payments where invoice_id=v_reject_invoice_id and method='EFT'
  ), 'rejection does not create a payment ledger transaction');
end;
$$;

select * from extensions.finish();
rollback;
