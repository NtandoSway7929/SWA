-- Expose a bounded recent-run history for the allowlisted Swayphics scheduled jobs.
-- Only safe status summaries are returned; cron return_message and command text
-- are deliberately excluded from the administrator-facing result.
begin;

create or replace function public.get_swayphics_automation_run_history(p_limit integer default 30)
returns table (
    run_id bigint,
    job_name text,
    started_at timestamptz,
    finished_at timestamptz,
    duration_ms bigint,
    run_status text,
    result_summary text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit integer := coalesce(p_limit, 30);
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    if v_limit < 1 or v_limit > 50 then
        raise exception 'Automation run history limit must be between 1 and 50.';
    end if;

    return query
    select
        d.runid::bigint,
        j.jobname::text,
        d.start_time,
        d.end_time,
        case
            when d.end_time is null then null::bigint
            else round(extract(epoch from (d.end_time - d.start_time)) * 1000)::bigint
        end,
        d.status::text,
        case d.status::text
            when 'succeeded' then 'Completed successfully.'
            when 'failed' then 'Failed. Review Supabase job logs for details.'
            when 'running' then 'Currently running.'
            else 'An unrecognised run status was recorded.'
        end
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname in (
        'swayphics-stale-lead-followups',
        'swayphics-invoice-status-refresh',
        'swayphics-leads-due-today',
        'swayphics-quote-expiry-reminders'
    )
    order by d.start_time desc, d.runid desc
    limit v_limit;
end;
$$;

revoke all privileges on function public.get_swayphics_automation_run_history(integer)
    from public, anon, service_role;
grant execute on function public.get_swayphics_automation_run_history(integer)
    to authenticated;

notify pgrst, 'reload schema';

commit;
