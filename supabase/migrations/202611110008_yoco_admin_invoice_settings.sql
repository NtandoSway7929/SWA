-- Stage 1.48: administrator controls for invoice-level Yoco payment settings
-- Feature branch only. Do not apply to production as part of this preparation.
begin;

create or replace function public.admin_set_invoice_yoco_settings(
    p_invoice_id uuid,
    p_online_payment_enabled boolean,
    p_partial_payment_enabled boolean,
    p_deposit_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invoice public.invoices%rowtype;
    v_online boolean := coalesce(p_online_payment_enabled, false);
    v_partial boolean := coalesce(p_partial_payment_enabled, false);
    v_deposit numeric(12,2) := p_deposit_amount;
begin
    if auth.uid() is null or not coalesce(public.is_swayphics_admin(), false) then
        raise exception 'Administrator access is required.'
            using errcode = '42501';
    end if;

    if p_invoice_id is null then
        raise exception 'A valid invoice is required.';
    end if;

    select i.*
    into v_invoice
    from public.invoices i
    where i.id = p_invoice_id
    for update;

    if not found then
        raise exception 'Invoice not found.';
    end if;

    if v_invoice.status in ('draft', 'cancelled', 'paid')
       or coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) <= 0 then
        raise exception 'Only issued invoices with an outstanding balance can accept online payment settings.';
    end if;

    if v_partial and not v_online then
        raise exception 'Partial payments require online payments to be enabled.';
    end if;

    if v_deposit is not null then
        if not v_partial then
            raise exception 'A minimum deposit can only be configured when partial payments are enabled.';
        end if;
        if v_deposit <= 0
           or v_deposit > coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) then
            raise exception 'The minimum deposit must be greater than zero and no greater than the outstanding balance.';
        end if;
        v_deposit := round(v_deposit, 2);
    end if;

    update public.invoices
    set online_payment_enabled = v_online,
        partial_payment_enabled = v_partial,
        deposit_amount = case when v_online and v_partial then v_deposit else null end,
        updated_at = now()
    where id = p_invoice_id;

    return jsonb_build_object(
        'invoice_id', p_invoice_id,
        'online_payment_enabled', v_online,
        'partial_payment_enabled', v_partial,
        'deposit_amount', case when v_online and v_partial then v_deposit else null end
    );
end;
$$;

revoke all on function public.admin_set_invoice_yoco_settings(uuid, boolean, boolean, numeric)
    from public, anon;
grant execute on function public.admin_set_invoice_yoco_settings(uuid, boolean, boolean, numeric)
    to authenticated;

commit;
