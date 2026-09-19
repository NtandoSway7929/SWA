-- SWAYPHICS PAYMENT / INVOICE INTEGRITY PATCH
-- Run once in the Supabase SQL Editor after the existing business-flow migration.
--
-- Enforces:
--   1) New payments must reference an invoice.
--   2) An existing payment cannot be reassigned to another invoice.
--   3) Client/project linkage always follows the selected invoice.
--   4) Cancelled invoices cannot receive payments.
--   5) Payments cannot exceed the invoice balance.
--
-- This is intentionally separate from the main business-flow migration so it
-- can be applied to an already-running Swayphics workspace safely.

create or replace function public.enforce_swayphics_payment_invoice_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as 'declare
    v_invoice_client_id uuid;
    v_invoice_project_id uuid;
    v_invoice_total numeric(12,2);
    v_invoice_status text;
    v_existing_paid numeric(12,2);
    v_available_balance numeric(12,2);
begin
    if new.invoice_id is null then
        if tg_op = ''INSERT'' then
            raise exception ''Payments must reference a specific invoice number.'';
        end if;

        return new;
    end if;

    select
        client_id,
        project_id,
        total,
        status
    into
        v_invoice_client_id,
        v_invoice_project_id,
        v_invoice_total,
        v_invoice_status
    from public.invoices
    where id = new.invoice_id
    for update;

    if not found then
        raise exception ''The selected invoice does not exist.'';
    end if;

    if v_invoice_status = ''cancelled'' then
        raise exception ''Cancelled invoices cannot receive payments.'';
    end if;

    if tg_op = ''UPDATE''
       and old.invoice_id is distinct from new.invoice_id then
        raise exception ''The invoice attached to an existing payment cannot be changed.'';
    end if;

    if new.amount is null or new.amount <= 0 then
        raise exception ''Payment amount must be greater than R0.'';
    end if;

    select coalesce(
        sum(
            case
                when p.status in (''paid'', ''partially paid'')
                    then p.amount
                else 0
            end
        ),
        0
    )
    into v_existing_paid
    from public.payments p
    where p.invoice_id = new.invoice_id
      and p.id is distinct from new.id;

    v_available_balance :=
        greatest(
            coalesce(v_invoice_total, 0) -
            coalesce(v_existing_paid, 0),
            0
        );

    if new.amount > v_available_balance then
        raise exception
            ''Payment exceeds the available invoice balance of R%.2f.'',
            v_available_balance;
    end if;

    -- Invoice is authoritative for relationship fields.
    new.client_id := v_invoice_client_id;
    new.project_id := v_invoice_project_id;
    new.status := ''paid'';

    return new;
end';

drop trigger if exists trg_enforce_swayphics_payment_invoice_integrity
on public.payments;

create trigger trg_enforce_swayphics_payment_invoice_integrity
before insert or update on public.payments
for each row
execute function public.enforce_swayphics_payment_invoice_integrity();

-- Keep the trigger callable by the authenticated workspace through the table
-- operation; the function runs with controlled definer privileges.
grant execute on function public.enforce_swayphics_payment_invoice_integrity()
to authenticated;
