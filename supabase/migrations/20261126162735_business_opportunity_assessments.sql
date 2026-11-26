create table public.business_assessments (
    id uuid primary key default gen_random_uuid(),
    assessment_version text not null check (length(btrim(assessment_version)) between 1 and 64),
    status text not null default 'completed'
        check (status in ('completed', 'contact_requested', 'converted', 'archived')),
    business_name text,
    industry text not null check (length(btrim(industry)) between 1 and 80),
    business_profile jsonb not null default '{}'::jsonb,
    responses jsonb not null,
    findings jsonb not null,
    report jsonb not null,
    contact_requested boolean not null default false,
    contact_requested_at timestamptz,
    contact_notice_version text,
    submission_key uuid not null unique,
    lead_id uuid references public.leads(id) on delete set null,
    submitted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint business_assessments_profile_object check (jsonb_typeof(business_profile) = 'object'),
    constraint business_assessments_responses_array check (jsonb_typeof(responses) = 'array'),
    constraint business_assessments_findings_array check (jsonb_typeof(findings) = 'array'),
    constraint business_assessments_report_object check (jsonb_typeof(report) = 'object')
);

create index business_assessments_submitted_at_idx
    on public.business_assessments (submitted_at desc);
create index business_assessments_status_submitted_at_idx
    on public.business_assessments (status, submitted_at desc);
create index business_assessments_industry_submitted_at_idx
    on public.business_assessments (industry, submitted_at desc);
create index business_assessments_lead_id_idx
    on public.business_assessments (lead_id)
    where lead_id is not null;

alter table public.website_enquiries
    add column source text not null default 'Website',
    add column assessment_id uuid
        references public.business_assessments(id) on delete set null;

create unique index website_enquiries_assessment_id_unique
    on public.website_enquiries (assessment_id)
    where assessment_id is not null;

alter table public.business_assessments enable row level security;
revoke all on table public.business_assessments from public, anon, authenticated;
grant select on table public.business_assessments to authenticated;
grant all on table public.business_assessments to service_role;

create policy "Swayphics admins can view business assessments"
    on public.business_assessments
    for select
    to authenticated
    using (public.is_swayphics_admin());

create table public.business_assessment_rate_limits (
    scope text not null check (scope in ('assessment_ip', 'contact_ip', 'contact_email')),
    identifier_hash text not null check (identifier_hash ~ '^[a-f0-9]{64}$'),
    attempts integer not null default 0 check (attempts >= 0),
    window_started_at timestamptz not null default now(),
    primary key (scope, identifier_hash)
);

create index business_assessment_rate_limits_window_idx
    on public.business_assessment_rate_limits (window_started_at);

alter table public.business_assessment_rate_limits enable row level security;
revoke all on table public.business_assessment_rate_limits from public, anon, authenticated;
grant all on table public.business_assessment_rate_limits to service_role;

create or replace function public.take_business_assessment_rate_limit(
    p_scope text,
    p_identifier_hash text,
    p_max_attempts integer,
    p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_attempts integer;
    v_window_started_at timestamptz;
    v_retry_after integer;
begin
    if p_scope not in ('assessment_ip', 'contact_ip', 'contact_email')
       or p_identifier_hash !~ '^[a-f0-9]{64}$'
       or p_max_attempts < 1 or p_max_attempts > 100
       or p_window_seconds < 60 or p_window_seconds > 604800 then
        raise exception 'Invalid rate limit parameters.' using errcode = '22023';
    end if;

    delete from public.business_assessment_rate_limits
    where window_started_at < now() - interval '2 days';

    insert into public.business_assessment_rate_limits as current_limit
        (scope, identifier_hash, attempts, window_started_at)
    values
        (p_scope, p_identifier_hash, 1, now())
    on conflict (scope, identifier_hash) do update
        set attempts = case
                when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
                    then 1
                else current_limit.attempts + 1
            end,
            window_started_at = case
                when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds)
                    then now()
                else current_limit.window_started_at
            end
    returning current_limit.attempts, current_limit.window_started_at
        into v_attempts, v_window_started_at;

    v_retry_after := greatest(
        1,
        ceil(extract(epoch from (
            v_window_started_at + make_interval(secs => p_window_seconds) - now()
        )))::integer
    );

    return query
        select
            v_attempts <= p_max_attempts,
            case when v_attempts <= p_max_attempts then 0 else v_retry_after end;
end;
$function$;

revoke all on function public.take_business_assessment_rate_limit(text, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.take_business_assessment_rate_limit(text, text, integer, integer)
    to service_role;

create or replace function public.request_business_assessment_contact(
    p_assessment_id uuid,
    p_submission_key uuid,
    p_contact_name text,
    p_email text,
    p_phone text,
    p_preferred_contact_method text,
    p_message text,
    p_notice_version text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_business_name text;
    v_email text;
    v_phone text;
    v_existing_enquiry_id uuid;
    v_enquiry_id uuid;
begin
    if p_assessment_id is null or p_submission_key is null then
        raise exception 'Assessment reference is required.' using errcode = '22023';
    end if;

    if p_contact_name is null or length(btrim(p_contact_name)) < 2
       or length(btrim(p_contact_name)) > 80 then
        raise exception 'A valid contact name is required.' using errcode = '22023';
    end if;

    if p_preferred_contact_method not in ('email', 'phone', 'whatsapp') then
        raise exception 'A valid preferred contact method is required.' using errcode = '22023';
    end if;

    if p_notice_version is null or length(btrim(p_notice_version)) not between 1 and 40 then
        raise exception 'The contact notice version is required.' using errcode = '22023';
    end if;

    if p_message is not null and length(p_message) > 1000 then
        raise exception 'The message is too long.' using errcode = '22023';
    end if;

    v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
    v_phone := nullif(btrim(coalesce(p_phone, '')), '');

    if v_email is not null and (
        length(v_email) > 120
        or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if v_phone is not null and (
        length(v_phone) < 6
        or length(v_phone) > 30
        or v_phone !~ '^[0-9+() .-]+$'
    ) then
        raise exception 'A valid phone number is required.' using errcode = '22023';
    end if;

    if v_email is null and v_phone is null then
        raise exception 'Provide an email address or phone number.' using errcode = '22023';
    end if;

    if p_preferred_contact_method = 'email' and v_email is null then
        raise exception 'An email address is required for email contact.' using errcode = '22023';
    end if;

    if p_preferred_contact_method in ('phone', 'whatsapp') and v_phone is null then
        raise exception 'A phone number is required for the selected contact method.' using errcode = '22023';
    end if;

    select a.business_name
      into v_business_name
      from public.business_assessments as a
     where a.id = p_assessment_id
       and a.submission_key = p_submission_key
     for update;

    if not found then
        raise exception 'Assessment not found.' using errcode = 'P0002';
    end if;

    select e.id
      into v_existing_enquiry_id
      from public.website_enquiries as e
     where e.assessment_id = p_assessment_id;

    if v_existing_enquiry_id is not null then
        update public.business_assessments
           set contact_requested = true,
               status = case when status = 'completed' then 'contact_requested' else status end,
               contact_requested_at = coalesce(contact_requested_at, now()),
               contact_notice_version = coalesce(contact_notice_version, p_notice_version),
               updated_at = now()
         where id = p_assessment_id;
        return v_existing_enquiry_id;
    end if;

    insert into public.website_enquiries (
        name, business_name, email, phone, service, message, source, assessment_id
    )
    values (
        btrim(p_contact_name),
        nullif(btrim(coalesce(v_business_name, '')), ''),
        v_email,
        v_phone,
        'Business Opportunity Finder',
        concat_ws(
            E'\n\n',
            'Business Opportunity Finder assessment reference: ' || p_assessment_id::text,
            'Preferred contact method: ' || p_preferred_contact_method,
            nullif(btrim(coalesce(p_message, '')), '')
        ),
        'Business Opportunity Finder',
        p_assessment_id
    )
    on conflict (assessment_id) where assessment_id is not null do nothing
    returning id into v_enquiry_id;

    if v_enquiry_id is null then
        select e.id into v_enquiry_id
          from public.website_enquiries as e
         where e.assessment_id = p_assessment_id;
    end if;

    if v_enquiry_id is null then
        raise exception 'The contact request could not be recorded.' using errcode = 'P0001';
    end if;

    update public.business_assessments
       set contact_requested = true,
           status = case when status = 'completed' then 'contact_requested' else status end,
           contact_requested_at = coalesce(contact_requested_at, now()),
           contact_notice_version = coalesce(contact_notice_version, p_notice_version),
           updated_at = now()
     where id = p_assessment_id;

    return v_enquiry_id;
end;
$function$;

revoke all on function public.request_business_assessment_contact(uuid, uuid, text, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.request_business_assessment_contact(uuid, uuid, text, text, text, text, text, text)
    to service_role;