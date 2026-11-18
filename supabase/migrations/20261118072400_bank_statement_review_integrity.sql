-- Phase 2.3 hardening: enforce review integrity at the table boundary.
-- The RPC remains SECURITY INVOKER. Authenticated owners can update only the
-- four decision columns; the trigger validates the decision and stamps audit fields.

begin;

drop index if exists public.bank_statement_lines_matched_source_idx;
create unique index bank_statement_lines_matched_source_idx
    on public.bank_statement_lines(matched_source_type, matched_source_id)
    where match_status = 'matched';

revoke update on table public.bank_statement_lines from authenticated;
grant update (match_status, matched_source_type, matched_source_id, ignore_reason)
    on table public.bank_statement_lines to authenticated;

create or replace function public.guard_bank_statement_line_ledger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_amount numeric(12,2);
    v_currency text;
    v_status text;
    v_entry_type text;
    v_source_date date;
    v_method text;
begin
    if tg_op = 'DELETE' then
        raise exception 'Imported bank statement lines cannot be deleted.';
    end if;

    if auth.uid() is null or not public.is_swayphics_owner() then
        raise exception 'Only the Swayphics owner can review bank statement lines.';
    end if;

    if row(
        new.import_id, new.row_number, new.transaction_date, new.description,
        new.bank_reference, new.amount, new.currency, new.line_fingerprint,
        new.created_at
    ) is distinct from row(
        old.import_id, old.row_number, old.transaction_date, old.description,
        old.bank_reference, old.amount, old.currency, old.line_fingerprint,
        old.created_at
    ) then
        raise exception 'Imported bank statement source data is immutable.';
    end if;

    if old.match_status <> 'unmatched' then
        raise exception 'A reviewed bank statement line cannot be changed again.';
    end if;

    if new.match_status not in ('matched', 'ignored') then
        raise exception 'A statement line can only be matched or ignored during review.';
    end if;

    new.matched_by := auth.uid();
    new.matched_at := now();

    if new.match_status = 'matched' then
        if new.matched_source_id is null
           or new.matched_source_type is null
           or new.matched_source_type not in ('payment', 'budget_entry') then
            raise exception 'Choose an eligible payment or posted budget entry.';
        end if;
        if new.ignore_reason is not null then
            raise exception 'A matched line cannot include an ignore reason.';
        end if;

        perform pg_advisory_xact_lock(
            hashtextextended(new.matched_source_type || ':' || new.matched_source_id::text, 0)
        );

        if new.matched_source_type = 'payment' then
            if new.amount <= 0 then
                raise exception 'A payment can only be matched to a bank credit.';
            end if;

            select amount, currency, status, paid_at, method
              into v_amount, v_currency, v_status, v_source_date, v_method
              from public.payments
             where id = new.matched_source_id
               and provider is null;

            if not found or v_status is distinct from 'paid'
               or v_currency is distinct from 'ZAR'
               or v_amount <> abs(new.amount)
               or v_method is distinct from 'EFT'
               or v_source_date is null
               or abs(v_source_date - new.transaction_date) > 7 then
                raise exception 'The payment must be a paid manual EFT ZAR record with the exact amount and a date within seven days.';
            end if;

        elsif new.matched_source_type = 'budget_entry' then
            select amount, currency, status, entry_type, transaction_date, payment_method
              into v_amount, v_currency, v_status, v_entry_type, v_source_date, v_method
              from public.budget_entries
             where id = new.matched_source_id;

            if not found or v_status is distinct from 'posted'
               or v_currency is distinct from 'ZAR'
               or v_amount <> abs(new.amount)
               or (new.amount > 0 and v_entry_type is distinct from 'income')
               or (new.amount < 0 and v_entry_type is distinct from 'expense')
               or v_method is null
               or v_method not in ('EFT', 'Card', 'Debit order')
               or v_source_date is null
               or abs(v_source_date - new.transaction_date) > 7 then
                raise exception 'The posted budget entry must match the statement amount, direction and be dated within seven days.';
            end if;
        end if;

    elsif new.match_status = 'ignored' then
        if new.matched_source_type is not null or new.matched_source_id is not null then
            raise exception 'Ignored lines cannot reference a financial record.';
        end if;
        if new.ignore_reason is null
           or length(btrim(new.ignore_reason)) not between 1 and 1000 then
            raise exception 'Ignoring a line requires a reason between 1 and 1000 characters.';
        end if;
    end if;

    return new;
end;
$$;

revoke all on function public.guard_bank_statement_line_ledger()
    from public, anon, authenticated, service_role;

commit;
