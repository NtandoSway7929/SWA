-- Keep the Swayphics IMAP inbox synchronized even when the admin dashboard is closed.
-- The scheduler key is generated inside Vault and never appears in this migration or cron command.

begin;

select vault.create_secret(
    encode(extensions.gen_random_bytes(32), 'hex'),
    'swayphics_email_sync_cron_key',
    'Private key used only by the scheduled Swayphics inbox sync.'
)
where not exists (
    select 1
    from vault.secrets
    where name = 'swayphics_email_sync_cron_key'
);

create or replace function public.validate_swayphics_email_sync_cron_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (
            select ds.decrypted_secret = p_key
            from vault.decrypted_secrets ds
            where ds.name = 'swayphics_email_sync_cron_key'
            order by ds.created_at desc
            limit 1
        ),
        false
    );
$$;

-- Only the server-side service-role client may ask whether a scheduler key is valid.
revoke all privileges on function public.validate_swayphics_email_sync_cron_key(text)
    from public, anon, authenticated;
grant execute on function public.validate_swayphics_email_sync_cron_key(text)
    to service_role;

-- Replace the named job idempotently if this migration is re-applied manually.
do $schedule$
declare
    v_existing_job_id bigint;
begin
    select jobid
    into v_existing_job_id
    from cron.job
    where jobname = 'swayphics-email-inbox-sync';

    if v_existing_job_id is not null then
        perform cron.unschedule(v_existing_job_id);
    end if;

    perform cron.schedule(
        'swayphics-email-inbox-sync',
        '30 seconds',
        $command$
            select net.http_post(
                url := 'https://sqifhribgsqfaxgtobsa.supabase.co/functions/v1/sync-email-inbox',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'apikey', 'sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB',
                    'x-swayphics-email-sync-key',
                    (
                        select ds.decrypted_secret
                        from vault.decrypted_secrets ds
                        where ds.name = 'swayphics_email_sync_cron_key'
                        order by ds.created_at desc
                        limit 1
                    )
                ),
                body := '{}'::jsonb,
                timeout_milliseconds := 55000
            );
        $command$
    );
end;
$schedule$;

notify pgrst, 'reload schema';

commit;
