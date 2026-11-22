begin;

-- Capture the client identity at the moment a receipt is issued.
-- Receipt rows are immutable after insertion, so the PDF can be regenerated
-- later without silently changing the original customer details.
create or replace function innerme_private.capture_payment_receipt_client_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_business_name text;
  v_contact_name text;
  v_email text;
begin
  v_client_id := nullif(new.snapshot ->> 'client_id', '')::uuid;

  if v_client_id is null then
    select p.client_id into v_client_id
    from public.payments p
    where p.id = new.payment_id;
  end if;

  if v_client_id is null then
    return new;
  end if;

  select c.business_name, c.contact_name, c.email
  into v_business_name, v_contact_name, v_email
  from public.clients c
  where c.id = v_client_id;

  if not found then
    return new;
  end if;

  new.snapshot := coalesce(new.snapshot, '{}'::jsonb) || jsonb_build_object(
    'client_business_name', v_business_name,
    'client_contact_name', v_contact_name,
    'client_email', v_email
  );

  return new;
end;
$$;

revoke all on function innerme_private.capture_payment_receipt_client_snapshot()
  from public, anon, authenticated;

drop trigger if exists trg_capture_payment_receipt_client_snapshot
  on public.payment_receipts;

create trigger trg_capture_payment_receipt_client_snapshot
before insert on public.payment_receipts
for each row
execute function innerme_private.capture_payment_receipt_client_snapshot();

commit;
