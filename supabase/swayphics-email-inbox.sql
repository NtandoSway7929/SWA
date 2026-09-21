-- SWAYPHICS EMAIL INBOX
-- Run this migration once in Supabase SQL Editor.
--
-- Incoming mail is synchronized from the info@swayphics.co.za IMAP mailbox
-- into this table. Outbound dashboard emails are also recorded here so
-- replies can remain inside the same conversation thread.

create table if not exists public.email_messages (
    id uuid primary key default gen_random_uuid(),

    direction text not null
        check (direction in ('inbound','outbound')),

    mailbox text not null default 'info@swayphics.co.za',

    source_key text not null unique,

    imap_uid bigint,

    external_id text,

    message_id text,

    in_reply_to text,

    references_header text,

    thread_id text not null,

    from_name text,

    from_email text,

    to_email text,

    subject text,

    text_body text not null default '',

    html_body text,

    received_at timestamptz not null default now(),

    is_read boolean not null default false,

    client_id uuid references public.clients(id) on delete set null,

    lead_id uuid references public.leads(id) on delete set null,

    created_by uuid references public.admin_users(user_id) on delete set null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists email_messages_thread_idx
    on public.email_messages(thread_id, received_at asc);

create index if not exists email_messages_received_idx
    on public.email_messages(received_at desc);

create index if not exists email_messages_unread_idx
    on public.email_messages(is_read, received_at desc);

create index if not exists email_messages_from_email_idx
    on public.email_messages(from_email);

create index if not exists email_messages_message_id_idx
    on public.email_messages(message_id);

alter table public.email_messages enable row level security;

grant select, insert, update, delete
on table public.email_messages
to authenticated, service_role;

drop policy if exists "Swayphics admins can manage email messages"
    on public.email_messages;

create policy "Swayphics admins can manage email messages"
on public.email_messages
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

notify pgrst, 'reload schema';

-- After running the migration, configure this Supabase Edge Function secret:
--
-- EMAIL_IMAP_PASSWORD = the password/application password for
--                       info@swayphics.co.za
--
-- The sync function uses these defaults unless overridden:
-- EMAIL_IMAP_HOST = mail.privateemail.com
-- EMAIL_IMAP_PORT = 993
-- EMAIL_IMAP_USER = info@swayphics.co.za
