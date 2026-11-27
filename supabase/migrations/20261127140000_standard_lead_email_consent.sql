begin;

alter table public.leads
  add column if not exists email_consent_required boolean not null default false,
  add column if not exists email_consent_status text not null default 'not_required',
  add column if not exists email_consent_requested_at timestamptz,
  add column if not exists email_consent_granted_at timestamptz,
  add column if not exists email_consent_declined_at timestamptz,
  add column if not exists email_consent_revoked_at timestamptz,
  add column if not exists email_consent_channel text,
  add column if not exists email_consent_response_name text,
  add column if not exists email_consent_response_role text,
  add column if not exists email_consent_evidence text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_email_consent_status_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_email_consent_status_check
      check (email_consent_status in (
        'not_required', 'not_requested', 'sending', 'requested',
        'granted', 'declined', 'revoked'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_email_consent_channel_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_email_consent_channel_check
      check (
        email_consent_channel is null
        or email_consent_channel in ('Email', 'WhatsApp', 'SMS', 'Phone', 'In person')
      );
  end if;
end;
$$;

create table if not exists public.lead_email_consent_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  business_name text not null,
  email_address text,
  event_type text not null check (event_type in (
    'request_sent', 'consent_granted', 'consent_declined', 'consent_revoked'
  )),
  channel text not null check (channel in ('Email', 'WhatsApp', 'SMS', 'Phone', 'In person')),
  response_name text,
  response_role text,
  evidence text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists lead_email_consent_events_lead_created_idx
  on public.lead_email_consent_events (lead_id, created_at desc);

alter table public.lead_email_consent_events enable row level security;
revoke all on table public.lead_email_consent_events from public, anon, authenticated;
grant select on table public.lead_email_consent_events to authenticated;

drop policy if exists "Swayphics admins can read lead email consent events"
  on public.lead_email_consent_events;
create policy "Swayphics admins can read lead email consent events"
on public.lead_email_consent_events
for select to authenticated
using (public.is_swayphics_admin());

-- Consent state is write-protected from ordinary PostgREST updates.
-- The owner-only RPC below and the send-email Edge Function perform the
-- authorised updates; service_role and the migration owner are trusted.
create or replace function public.guard_lead_email_consent_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (
       new.email_consent_required is distinct from old.email_consent_required
       or new.email_consent_status is distinct from old.email_consent_status
       or new.email_consent_requested_at is distinct from old.email_consent_requested_at
       or new.email_consent_granted_at is distinct from old.email_consent_granted_at
       or new.email_consent_declined_at is distinct from old.email_consent_declined_at
       or new.email_consent_revoked_at is distinct from old.email_consent_revoked_at
       or new.email_consent_channel is distinct from old.email_consent_channel
       or new.email_consent_response_name is distinct from old.email_consent_response_name
       or new.email_consent_response_role is distinct from old.email_consent_response_role
       or new.email_consent_evidence is distinct from old.email_consent_evidence
     ) then
    raise exception 'Use the Swayphics email-consent workflow to change consent records.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_lead_email_consent_fields on public.leads;
create trigger trg_guard_lead_email_consent_fields
before update on public.leads
for each row execute function public.guard_lead_email_consent_fields();

revoke all on function public.guard_lead_email_consent_fields() from public, anon, authenticated;

create or replace function public.record_swayphics_lead_email_consent(
  p_lead_id uuid,
  p_decision text,
  p_response_name text,
  p_response_role text,
  p_evidence text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_name text := nullif(trim(coalesce(p_response_name, '')), '');
  v_role text := nullif(trim(coalesce(p_response_role, '')), '');
  v_evidence text := trim(coalesce(p_evidence, ''));
  v_status text;
  v_event text;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Active Swayphics administrator access is required.';
  end if;

  if v_decision not in ('grant', 'decline', 'revoke') then
    raise exception 'Decision must be grant, decline, or revoke.';
  end if;

  if length(v_evidence) < 8 or length(v_evidence) > 8000 then
    raise exception 'Paste the exact consent or refusal evidence (8 to 8000 characters).';
  end if;

  if v_decision = 'grant' and (v_name is null or v_role is null) then
    raise exception 'A full name and designation are required to record consent.';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found or v_lead.email_consent_required is distinct from true then
    raise exception 'This lead is not part of the email-consent workflow.';
  end if;

  if v_decision in ('grant', 'decline') and v_lead.email_consent_status <> 'requested' then
    raise exception 'A permission request must be recorded before a response can be captured.';
  end if;

  if v_decision = 'revoke' and v_lead.email_consent_status <> 'granted' then
    raise exception 'Only previously granted consent can be withdrawn.';
  end if;

  if v_decision = 'grant' then
    if v_evidence !~* '\m(yes|consent|agree|approve|opt[ -]?in)\M'
       or v_evidence !~* '\m(email|marketing)\M' then
      raise exception 'The evidence must explicitly confirm consent to receive email marketing.';
    end if;
    v_status := 'granted';
    v_event := 'consent_granted';
  elsif v_decision = 'decline' then
    v_status := 'declined';
    v_event := 'consent_declined';
  else
    v_status := 'revoked';
    v_event := 'consent_revoked';
  end if;

  update public.leads
  set email_consent_status = v_status,
      email_consent_channel = 'Email',
      email_consent_response_name = v_name,
      email_consent_response_role = v_role,
      email_consent_evidence = v_evidence,
      email_consent_granted_at = case when v_decision = 'grant' then v_now else email_consent_granted_at end,
      email_consent_declined_at = case when v_decision = 'decline' then v_now else email_consent_declined_at end,
      email_consent_revoked_at = case when v_decision = 'revoke' then v_now else email_consent_revoked_at end,
      updated_at = v_now
  where id = p_lead_id;

  insert into public.lead_email_consent_events (
    lead_id, business_name, email_address, event_type, channel,
    response_name, response_role, evidence, actor_id, created_at
  )
  values (
    p_lead_id, coalesce(v_lead.business_name, 'Unknown business'),
    v_lead.email, v_event, 'Email', v_name, v_role, v_evidence, auth.uid(), v_now
  );

  return jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'email_consent_status', v_status,
    'recorded_at', v_now
  );
end;
$$;

revoke all on function public.record_swayphics_lead_email_consent(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.record_swayphics_lead_email_consent(uuid, text, text, text, text)
  to authenticated;

-- The send-email Edge Function uses service_role to append the initial request event.
-- This keeps event writes off the browser-facing Data API table surface.
create or replace function public.record_swayphics_lead_email_request_sent(
  p_lead_id uuid,
  p_email_address text,
  p_evidence text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  v_lead public.leads%rowtype;
  v_evidence text := trim(coalesce(p_evidence, ''));
begin
  if length(v_evidence) < 8 or length(v_evidence) > 8000 then
    raise exception 'Permission request evidence must be between 8 and 8000 characters.';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
    and email_consent_required = true
    and email_consent_status = 'requested'
    and lower(coalesce(email, '')) = lower(coalesce(p_email_address, ''))
  for update;

  if not found then
    raise exception 'A matching Standard Lead with a recorded permission request was not found.';
  end if;

  insert into public.lead_email_consent_events (
    lead_id, business_name, email_address, event_type, channel,
    evidence, actor_id, created_at
  )
  values (
    v_lead.id, coalesce(v_lead.business_name, 'Unknown business'),
    v_lead.email, 'request_sent', 'Email', v_evidence, p_actor_id, now()
  );

  return jsonb_build_object(
    'success', true,
    'lead_id', v_lead.id,
    'event_type', 'request_sent'
  );
end;
$;

revoke all on function public.record_swayphics_lead_email_request_sent(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_swayphics_lead_email_request_sent(uuid, text, text, uuid)
  to service_role;

-- Only the specifically audited 30 cold-prospect records enter this
-- consent-gated first-contact workflow. Existing customer and inbound leads
-- are not changed by this migration.
update public.leads
set email_consent_required = true,
    email_consent_status = 'not_requested',
    email_consent_requested_at = null,
    email_consent_granted_at = null,
    email_consent_declined_at = null,
    email_consent_revoked_at = null,
    email_consent_channel = null,
    email_consent_response_name = null,
    email_consent_response_role = null,
    email_consent_evidence = null,
    updated_at = now()
where id in (
  '796256c9-59d8-47c3-891f-ccf36da8a4b8',
  '1048f3c1-1d5c-4b4f-8071-be01c910abbd',
  'b1f966bf-2e9a-4172-b5f2-326aaa5e8887',
  '22e118d9-abcb-4752-962f-c775a107b1d8',
  'e3900c38-85b1-4cb7-ac91-4400fb37cc6f',
  '81fc2dad-b995-4b24-a64c-d7aea21f11fc',
  'e7101501-ca2b-42e7-894b-2e0b7bf988e9',
  '7eff599a-d7f4-4f98-a189-ddd742f2d7ca',
  '41928e1f-aa59-492d-bc34-1288c7190a4f',
  'ac6b3df5-6572-4db5-ba47-60eff0f11562',
  '36b21d10-11e9-4d1e-ad67-57812e4a216b',
  '68ca3843-51ed-4be5-bd07-821ced2c7c4b',
  '74fcf546-aba0-4904-b2bf-e57e1fb0c544',
  'cb38df27-e5a3-488c-acac-1a85d3f834d4',
  '3acb9866-99ed-4c29-aa82-76a02dcfc8b3',
  '07130586-acf5-480f-93bc-7a3728b13513',
  '9dea7454-4d8f-4e15-a55f-f526c34138db',
  '19e288af-1108-4420-abad-0afd63e80324',
  'b9e46051-0bcb-4359-a262-14a52998ac78',
  'e9ed0ccb-b994-4a9a-bd2c-c1476fd77b1c',
  '1ba22708-5e93-45bb-bd7f-a65d91e164f0',
  'e65a2fd3-d1b1-4d7b-9669-2377e389eb78',
  '6338848c-979c-4ba4-9aee-1565e4ace434',
  '9803e77c-de06-45ad-ae1a-8e08b956ca8b',
  '1d92183e-ef91-4448-8073-1350d958699f',
  'edc592d4-70c3-4d5b-80a3-ef378c64452a',
  '9be8cc67-c171-42c4-bcc1-8b3dbde45a0f',
  'f1ea6086-bb09-4000-b6de-f612ae1c516e',
  'c58edc07-daaf-4cf0-8d39-9a5587060d9e',
  '23bff215-54b1-4ed4-9a14-81fef6cec2d3'
);


do $$
declare
  v_target_count integer;
begin
  select count(*) into v_target_count
  from public.leads
  where email_consent_required = true
    and id in (
      '796256c9-59d8-47c3-891f-ccf36da8a4b8',
      '1048f3c1-1d5c-4b4f-8071-be01c910abbd',
      'b1f966bf-2e9a-4172-b5f2-326aaa5e8887',
      '22e118d9-abcb-4752-962f-c775a107b1d8',
      'e3900c38-85b1-4cb7-ac91-4400fb37cc6f',
      '81fc2dad-b995-4b24-a64c-d7aea21f11fc',
      'e7101501-ca2b-42e7-894b-2e0b7bf988e9',
      '7eff599a-d7f4-4f98-a189-ddd742f2d7ca',
      '41928e1f-aa59-492d-bc34-1288c7190a4f',
      'ac6b3df5-6572-4db5-ba47-60eff0f11562',
      '36b21d10-11e9-4d1e-ad67-57812e4a216b',
      '68ca3843-51ed-4be5-bd07-821ced2c7c4b',
      '74fcf546-aba0-4904-b2bf-e57e1fb0c544',
      'cb38df27-e5a3-488c-acac-1a85d3f834d4',
      '3acb9866-99ed-4c29-aa82-76a02dcfc8b3',
      '07130586-acf5-480f-93bc-7a3728b13513',
      '9dea7454-4d8f-4e15-a55f-f526c34138db',
      '19e288af-1108-4420-abad-0afd63e80324',
      'b9e46051-0bcb-4359-a262-14a52998ac78',
      'e9ed0ccb-b994-4a9a-bd2c-c1476fd77b1c',
      '1ba22708-5e93-45bb-bd7f-a65d91e164f0',
      'e65a2fd3-d1b1-4d7b-9669-2377e389eb78',
      '6338848c-979c-4ba4-9aee-1565e4ace434',
      '9803e77c-de06-45ad-ae1a-8e08b956ca8b',
      '1d92183e-ef91-4448-8073-1350d958699f',
      'edc592d4-70c3-4d5b-80a3-ef378c64452a',
      '9be8cc67-c171-42c4-bcc1-8b3dbde45a0f',
      'f1ea6086-bb09-4000-b6de-f612ae1c516e',
      'c58edc07-daaf-4cf0-8d39-9a5587060d9e',
      '23bff215-54b1-4ed4-9a14-81fef6cec2d3'
    );
  if v_target_count <> 30 then
    raise exception 'Standard Lead consent migration expected 30 verified cohort records; found %.', v_target_count;
  end if;
end;
$$;

commit;
