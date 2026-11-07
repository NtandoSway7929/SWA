-- Store inbound MIME attachments privately and track media hydration for older inbox records.
alter table public.email_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists media_processed_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit)
values ('swayphics-email-attachments', 'swayphics-email-attachments', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Swayphics admins can read email attachments'
  ) then
    create policy "Swayphics admins can read email attachments"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'swayphics-email-attachments'
        and public.is_swayphics_admin()
      );
  end if;
end
$$;
