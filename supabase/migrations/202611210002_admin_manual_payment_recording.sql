begin;

-- Idempotency ledger for administrator-entered offline payments.
create table if not exists public.manual_payment_record_requests (
  idempotency_key uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_id uuid unique references public.payments(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.manual_payment_record_requests enable row level security;
revoke all on public.manual_payment_record_requests from public, anon, authenticated;
grant all on public.manual_payment_record_requests to service_role;

create or replace function innerme_private.record_manual_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_notes text,
  p_payment_date date,
  p_admin_user_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_request public.manual_payment_record_requests%rowtype;
  v_amount numeric(12,2);
  v_paid numeric(12,2);
  v_outstanding numeric(12,2);
  v_sequence bigint;
  v_receipt_number text;
  v_snapshot jsonb;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if p_invoice_id is null or p_admin_user_id is null or p_idempotency_key is null then
    raise exception 'Invoice, administrator and request key are required.';
  end if;

  if not exists (
    select 1 from public.admin_users au
    where au.user_id = p_admin_user_id and au.active = true
  ) then
    raise exception 'An active Swayphics administrator is required.';
  end if;

  if p_method not in ('EFT','Cash','Other') then
    raise exception 'Choose EFT, Cash or Other for a manually recorded payment.';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 then
    raise exception 'Enter a payment amount greater than R0.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <> p_amount then
    raise exception 'Payment amounts may contain no more than two decimal places.';
  end if;

  if p_method = 'EFT' and length(btrim(coalesce(p_reference,''))) = 0 then
    raise exception 'An EFT bank reference is required.';
  end if;
  if length(btrim(coalesce(p_reference,''))) > 120
     or length(btrim(coalesce(p_notes,''))) > 1000 then
    raise exception 'Reference or notes exceed the permitted length.';
  end if;
  if p_payment_date is null or p_payment_date > v_today then
    raise exception 'Payment date cannot be in the future.';
  end if;

  -- Serialize repeated submissions using the same idempotency key.
  insert into public.manual_payment_record_requests(
    idempotency_key, invoice_id, recorded_by
  ) values (
    p_idempotency_key, p_invoice_id, p_admin_user_id
  ) on conflict (idempotency_key) do nothing;

  select * into v_request
  from public.manual_payment_record_requests
  where idempotency_key = p_idempotency_key
  for update;

  if v_request.invoice_id <> p_invoice_id
     or v_request.recorded_by <> p_admin_user_id then
    raise exception 'This request key is already associated with a different payment request.';
  end if;

  if v_request.payment_id is not null then
    select * into v_payment from public.payments where id = v_request.payment_id;
    select * into v_receipt from public.payment_receipts where payment_id = v_payment.id;
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'payment_id', v_payment.id,
      'receipt_number', v_receipt.receipt_number,
      'amount', v_payment.amount,
      'currency', v_payment.currency
    );
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found
     or v_invoice.archived
     or v_invoice.status not in ('sent','partially paid','overdue')
     or v_invoice.status = 'cancelled'
     or v_invoice.total <= 0 then
    raise exception 'This invoice is not eligible for a manual payment.';
  end if;

  v_paid := least(
    innerme_private.swayphics_invoice_net_paid(v_invoice.id),
    greatest(coalesce(v_invoice.total,0),0)
  );
  v_outstanding := greatest(coalesce(v_invoice.total,0) - coalesce(v_paid,0),0);

  if v_amount > v_outstanding then
    raise exception 'Payment exceeds the current outstanding invoice balance of %.',
      to_char(v_outstanding, 'FM999999999990.00');
  end if;

  insert into public.payments(
    client_id, project_id, invoice_id, amount, status, method,
    reference, paid_at, notes, currency, provider
  ) values (
    v_invoice.client_id, v_invoice.project_id, v_invoice.id,
    v_amount, 'paid', p_method, nullif(btrim(coalesce(p_reference,'')),''),
    p_payment_date,
    concat(
      'Manually recorded and verified by an active Swayphics administrator.',
      case when length(btrim(coalesce(p_notes,''))) > 0
        then E'\n' || btrim(p_notes) else '' end
    ),
    v_invoice.currency, null
  ) returning * into v_payment;

  v_sequence := nextval('public.swayphics_payment_receipt_seq'::regclass);
  v_receipt_number := 'SW-RCPT-' ||
    to_char(now() at time zone 'Africa/Johannesburg', 'YYYY') ||
    '-' || lpad(v_sequence::text, 6, '0');

  v_snapshot := jsonb_build_object(
    'receipt_number', v_receipt_number,
    'issued_at', now(),
    'business', 'Swayphics',
    'client_id', v_invoice.client_id,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'method', v_payment.method,
    'provider', 'Manually recorded by Swayphics administrator',
    'reference', v_payment.reference,
    'payment_date', v_payment.paid_at
  );

  insert into public.payment_receipts(payment_id, receipt_number, snapshot)
  values (v_payment.id, v_receipt_number, v_snapshot)
  returning * into v_receipt;

  update public.manual_payment_record_requests
  set payment_id = v_payment.id
  where idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'payment_id', v_payment.id,
    'receipt_number', v_receipt.receipt_number,
    'amount', v_payment.amount,
    'currency', v_payment.currency,
    'invoice_id', v_invoice.id
  );
end;
$$;

revoke all on function innerme_private.record_manual_payment(uuid,numeric,text,text,text,date,uuid,uuid)
  from public, anon, authenticated;
grant execute on function innerme_private.record_manual_payment(uuid,numeric,text,text,text,date,uuid,uuid)
  to service_role;

create or replace function public.admin_record_manual_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_notes text,
  p_payment_date date,
  p_admin_user_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.record_manual_payment(
    p_invoice_id, p_amount, p_method, p_reference, p_notes,
    p_payment_date, p_admin_user_id, p_idempotency_key
  );
$$;

revoke all on function public.admin_record_manual_payment(uuid,numeric,text,text,text,date,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.admin_record_manual_payment(uuid,numeric,text,text,text,date,uuid,uuid)
  to service_role;

commit;
