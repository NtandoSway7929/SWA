
-- Keep the IMAP cursor scoped to the server's current UIDVALIDITY.
-- IMAP UIDs may be reassigned when a mailbox is recreated or restored.
alter table public.email_messages
    add column if not exists imap_uid_validity bigint;

drop index if exists public.email_messages_mailbox_imap_uid_unique_idx;

create unique index if not exists email_messages_mailbox_uid_validity_uid_unique_idx
    on public.email_messages (mailbox, imap_uid_validity, imap_uid)
    where imap_uid is not null
      and imap_uid_validity is not null;

-- Store only a one-way token hash in a private schema. The bearer token itself
-- remains encrypted in Vault and is read by pg_cron only when sending the job.
create table if not exists innerme_private.email_sync_cron_token_hashes (
    token_hash bytea primary key,
    created_at timestamptz not null default now()
);

revoke all on table innerme_private.email_sync_cron_token_hashes
    from public, anon, authenticated;

grant usage on schema innerme_private to service_role;
grant select on table innerme_private.email_sync_cron_token_hashes
    to service_role;

-- SECURITY INVOKER: only service_role can execute this RPC, and its only
-- readable data is the non-reversible hash in the private token table.
create or replace function public.verify_swayphics_email_sync_cron_token(
    p_token text
)
returns boolean
language sql
stable
set search_path = ''
as $$
    select
        p_token is not null
        and exists (
            select 1
            from innerme_private.email_sync_cron_token_hashes
            where token_hash = extensions.digest(p_token, 'sha256')
        );
$$;

revoke all on function public.verify_swayphics_email_sync_cron_token(text)
    from public, anon, authenticated;

grant execute on function public.verify_swayphics_email_sync_cron_token(text)
    to service_role;

-- Generate the secret once and ensure the private hash exists on retries.
do $$
declare
    v_token text;
begin
    select decrypted_secret
      into v_token
      from vault.decrypted_secrets
     where name = 'swayphics_email_sync_cron_token'
     order by created_at desc
     limit 1;

    if v_token is null then
        v_token := encode(extensions.gen_random_bytes(32), 'hex');

        perform vault.create_secret(
            v_token,
            'swayphics_email_sync_cron_token',
            'Private bearer token used only by the Swayphics email inbox cron job.'
        );
    end if;

    insert into innerme_private.email_sync_cron_token_hashes (token_hash)
    values (extensions.digest(v_token, 'sha256'))
    on conflict do nothing;
end;
$$;

-- Poll the HostAfrica HMailPlus mailbox without depending on an open browser tab.
-- The Edge Function validates the Vault-held token via the service-role RPC.
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
                            order by created_at desc
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
