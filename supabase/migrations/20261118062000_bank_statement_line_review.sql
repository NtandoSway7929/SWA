-- Phase 2.3: controlled, one-to-one review of imported bank statement lines.
-- This links a bank line to an existing financial record. It never creates or
-- changes payments, refunds, invoices, or budget entries.

begin;

create index if not exists bank_statement_lines_matched_source_idx
    on public.bank_statement_lines(matched_source_type, matched_source_id)
    where match_status = 'matched';

create or replace function public.review_bank_statement_line(
    p_line_id uuid,
    p_decision text,
    p_source_type text default null,
    p_source_id uuid default null,
    p_ignore_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_line public.bank_statement_lines%rowtype;
    v_amount numeric(12,2);
    v_currency text;
    v_status text;
    v_entry_type text;
    v_source_date date;
begin
    if auth.uid() is null or not public.is_swayphics_owner() then
        raise exception 'Only the Swayphics owner can review bank statement lines.';
    end if;

    select *
      into v_line
      from public.bank_statement_lines
     where id = p_line_id
     for update;

    if not found then
        raise exception 'The bank statement line could not be found.';
    end if;
    if v_line.match_status <> 'unmatched' then
        raise exception 'This statement line has already been reviewed.';
    end if;

    if p_decision = 'ignored' then
        if p_source_type is not null or p_source_id is not null then
            raise exception 'Ignored lines cannot reference a financial record.';
        end if;
        if p_ignore_reason is null or length(btrim(p_ignore_reason)) not between 1 and 1000 then
            raise exception 'Provide a reason between 1 and 1000 characters.';
        end if;

        update public.bank_statement_lines
           set match_status = 'ignored',
               ignore_reason = btrim(p_ignore_reason)
         where id = p_line_id;

        return jsonb_build_object('ok', true, 'decision', 'ignored', 'line_id', p_line_id);
    end if;

    if p_decision is distinct from 'matched' or p_source_id is null then
        raise exception 'Choose a valid match or ignore decision.';
    end if;

    -- Serialize reviews of the same source record so it cannot be linked twice.
    if p_source_type is null or p_source_type not in ('payment', 'budget_entry') then
        raise exception 'Only eligible payment and posted budget records can be matched. Test-environment refunds are excluded.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_source_type || ':' || p_source_id::text, 0));

    if exists (
        select 1
          from public.bank_statement_lines existing
         where existing.match_status = 'matched'
           and existing.matched_source_type = p_source_type
           and existing.matched_source_id = p_source_id
    ) then
        raise exception 'That financial record is already matched to another bank statement line.';
    end if;

    if p_source_type = 'payment' then
        if v_line.amount <= 0 then
            raise exception 'A payment can only be matched to a bank credit.';
        end if;

        select amount, currency, status, paid_at
          into v_amount, v_currency, v_status, v_source_date
          from public.payments
         where id = p_source_id
           and provider is null;

        if not found or v_status <> 'paid' or v_currency <> 'ZAR'
           or v_amount <> abs(v_line.amount)
           or v_source_date is null or abs(v_source_date - v_line.transaction_date) > 7 then
            raise exception 'The payment must be a paid, non-provider ZAR record with the exact amount and a date within seven days.';
        end if;

    elsif p_source_type = 'budget_entry' then
        select amount, currency, status, entry_type, transaction_date
          into v_amount, v_currency, v_status, v_entry_type, v_source_date
          from public.budget_entries
         where id = p_source_id;

        if not found or v_status <> 'posted' or v_currency <> 'ZAR'
           or v_amount <> abs(v_line.amount)
           or (v_line.amount > 0 and v_entry_type <> 'income')
           or (v_line.amount < 0 and v_entry_type <> 'expense')
           or abs(v_source_date - v_line.transaction_date) > 7 then
            raise exception 'The posted budget entry must match the statement amount, direction and be dated within seven days.';
        end if;
    end if;

    update public.bank_statement_lines
       set match_status = 'matched',
           matched_source_type = p_source_type,
           matched_source_id = p_source_id,
           ignore_reason = null
     where id = p_line_id;

    return jsonb_build_object(
        'ok', true,
        'decision', 'matched',
        'line_id', p_line_id,
        'source_type', p_source_type,
        'source_id', p_source_id
    );
end;
$$;

revoke all on function public.review_bank_statement_line(uuid, text, text, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.review_bank_statement_line(uuid, text, text, uuid, text)
    to authenticated;

commit;