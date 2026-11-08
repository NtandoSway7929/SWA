-- Expose a bounded recent-run history for the allowlisted Swayphics scheduled jobs.
-- Only safe status summaries are returned; cron return_message and command text
-- are deliberately excluded from the administrator-facing result.
begin;

create or replace function public.get_swayphics_automation_run_history(p_limit integer default 10)
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
    v_limit integer := coalesce(p_limit, 10);
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    if v_limit < 1 or v_limit > 20 then
        raise exception 'Automation run history limit must be between 1 and 20 per job.';
    end if;

    return query
    with ranked_runs as (
        select
            d.runid::bigint as run_id,
            j.jobname::text as job_name,
            d.start_time as started_at,
            d.end_time as finished_at,
            d.status::text as run_status,
            row_number() over (
                partition by j.jobid
                order by d.start_time desc, d.runid desc
            ) as job_run_rank
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
        where j.jobname in (
            'swayphics-stale-lead-followups',
            'swayphics-invoice-status-refresh',
            'swayphics-leads-due-today',
            'swayphics-quote-expiry-reminders'
        )
    )
    select
        r.run_id,
        r.job_name,
        r.started_at,
        r.finished_at,
        case
            when r.finished_at is null then null::bigint
            else round(extract(epoch from (r.finished_at - r.started_at)) * 1000)::bigint
        end,
        r.run_status,
        case r.run_status
            when 'succeeded' then 'Completed successfully.'
            when 'failed' then 'Failed. Review Supabase job logs for details.'
            when 'running' then 'Currently running.'
            else 'An unrecognised run status was recorded.'
        end
    from ranked_runs r
    where r.job_run_rank <= v_limit
    order by r.started_at desc, r.run_id desc;
end;
$$;

revoke all privileges on function public.get_swayphics_automation_run_history(integer)
    from public, anon, service_role;
grant execute on function public.get_swayphics_automation_run_history(integer)
    to authenticated;

notify pgrst, 'reload schema';

commit;
