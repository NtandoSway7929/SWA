-- Keep the IMAP cursor scoped to the server's current UIDVALIDITY.
-- IMAP UIDs may be reassigned when a mailbox is recreated or restored.
alter table public.email_messages
    add column if not exists imap_uid_validity bigint;

drop index if exists public.email_messages_mailbox_imap_uid_unique_idx;

create unique index if not exists email_messages_mailbox_uid_validity_uid_unique_idx
    on public.email_messages (mailbox, imap_uid_validity, imap_uid)
    where imap_uid is not null
      and imap_uid_validity is not null;

-- The cron token is stored encrypted in Vault. The verification RPC is
-- executable only by service_role, and runs as the caller (not SECURITY DEFINER).
create or replace function public.verify_swayphics_email_sync_cron_token(
    p_token text
)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1
        from vault.decrypted_secrets
        where name = 'swayphics_email_sync_cron_token'
          and decrypted_secret = p_token
    );
$$;

revoke all on function public.verify_swayphics_email_sync_cron_token(text)
    from public, anon, authenticated;

grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;
grant execute on function public.verify_swayphics_email_sync_cron_token(text)
    to service_role;

-- Generate the token once. It never enters the repository or a browser bundle.
do $$
begin
    if not exists (
        select 1
        from vault.secrets
        where name = 'swayphics_email_sync_cron_token'
    ) then
        perform vault.create_secret(
            encode(gen_random_bytes(32), 'hex'),
            'swayphics_email_sync_cron_token',
            'Private bearer token used only by the Swayphics email inbox cron job.'
        );
    end if;
end;
$$;

-- Poll the HostAfrica HMailPlus mailbox without depending on an open browser tab.
-- The Edge Function validates the Vault-held token through the service-role RPC.
do $$
begin
    perform cron.schedule(
        'swayphics-email-inbox-sync',
        '* * * * *',
        $cron$
            select net.http_post(
                url := 'https://sqifhribgsqfaxgtobsa.supabase.co/functions/v1/sync-email-inbox',
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'apikey', 'sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB',
                    'Authorization',
                        'Bearer ' || (
                            select decrypted_secret
                            from vault.decrypted_secrets
                            where name = 'swayphics_email_sync_cron_token'
                            limit 1
                        )
                ),
                body := '{}'::jsonb,
                timeout_milliseconds := 30000
            );
        $cron$
    );
end;
$$;
