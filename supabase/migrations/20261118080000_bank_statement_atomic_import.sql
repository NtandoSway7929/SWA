-- Phase 2.2: atomically persist a validated bank statement import.
-- Invoked only by an authenticated owner through Supabase RPC. The function
-- runs as the caller so table grants and RLS remain in force.

begin;

create or replace function public.import_bank_statement(
    p_account_label text,
    p_source_file_name text,
    p_source_file_sha256 text,
    p_period_start date,
    p_period_end date,
    p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_import_id uuid;
    v_row_count integer;
begin
    if auth.uid() is null or not public.is_swayphics_owner() then
        raise exception 'Only the Swayphics owner can import bank statements.';
    end if;

    if jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'Statement rows must be supplied as a JSON array.';
    end if;

    if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 10000 then
        raise exception 'A statement must contain between 1 and 10,000 transaction rows.';
    end if;

    if p_period_end < p_period_start then
        raise exception 'The statement period is invalid.';
    end if;

    insert into public.bank_statement_imports (
        account_label, source_file_name, source_file_sha256,
        period_start, period_end, row_count, imported_by
    ) values (
        p_account_label, p_source_file_name, p_source_file_sha256,
        p_period_start, p_period_end, jsonb_array_length(p_rows), auth.uid()
    )
    returning id into v_import_id;

    insert into public.bank_statement_lines (
        import_id, row_number, transaction_date, description,
        bank_reference, amount, line_fingerprint
    )
    select
        v_import_id,
        r.row_number,
        r.transaction_date,
        r.description,
        nullif(r.bank_reference, ''),
        r.amount,
        r.line_fingerprint
    from jsonb_to_recordset(p_rows) as r(
        row_number integer,
        transaction_date date,
        description text,
        bank_reference text,
        amount numeric(12,2),
        line_fingerprint text
    );

    get diagnostics v_row_count = row_count;

    if v_row_count <> jsonb_array_length(p_rows) then
        raise exception 'The imported row count does not match the validated preview.';
    end if;

    return jsonb_build_object(
        'ok', true,
        'import_id', v_import_id,
        'row_count', v_row_count
    );
exception
    when unique_violation then
        raise exception 'This statement file has already been imported for this account.';
end;
$$;

revoke all on function public.import_bank_statement(text, text, text, date, date, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.import_bank_statement(text, text, text, date, date, jsonb)
    to authenticated;

commit;