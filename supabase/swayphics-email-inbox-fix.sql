-- SWAYPHICS EMAIL INBOX FIX
-- Run once in the Supabase SQL Editor for existing installations.
--
-- The mailbox is hosted by HOSTAFRICA HMailPlus.
-- Incoming mail is read over IMAP and stored in public.email_messages.

create unique index if not exists email_messages_mailbox_imap_uid_unique_idx
    on public.email_messages(mailbox, imap_uid)
    where imap_uid is not null;

do $$
begin
    if exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'communication_logs'
    ) then
        null;
    else
        alter publication supabase_realtime add table public.communication_logs;
    end if;

    if exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'email_messages'
    ) then
        null;
    else
        alter publication supabase_realtime add table public.email_messages;
    end if;
end
$$;

select
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('communication_logs', 'email_messages')
order by tablename;
