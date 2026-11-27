-- Secure, revision-bound proposal review and client acceptance.
-- Review links are separate from the client portal: prospects can respond
-- before conversion into clients. Public access is limited to two RPCs.
begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.quote_review_links (
    id uuid primary key default gen_random_uuid(),
    quote_id uuid not null references public.quotes(id) on delete restrict,
    proposal_version_id uuid not null references public.lead_proposal_versions(id) on delete restrict,
    token_hash text not null unique,
    recipient_email text not null,
    recipient_name text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    expires_at timestamptz not null,
    sent_at timestamptz not null default now(),
    first_viewed_at timestamptz,
    responded_at timestamptz,
    revoked_at timestamptz,
    revoke_reason text,
    created_at timestamptz not null default now(),
    constraint quote_review_links_expiry_after_sent_check
        check (expires_at > sent_at)
);

create index if not exists quote_review_links_quote_created_idx
    on public.quote_review_links (quote_id, created_at desc);

create index if not exists quote_review_links_active_expiry_idx
    on public.quote_review_links (expires_at)
    where revoked_at is null and responded_at is null;

create table if not exists public.quote_review_responses (
    id uuid primary key default gen_random_uuid(),
    review_link_id uuid not null unique
        references public.quote_review_links(id) on delete restrict,
    quote_id uuid not null references public.quotes(id) on delete restrict,
    proposal_version_id uuid not null
        references public.lead_proposal_versions(id) on delete restrict,
    decision text not null check (decision in ('accepted','rejected')),
    respondent_name text not null,
    respondent_email text not null,
    message text,
    submitted_at timestamptz not null default now()
);

create index if not exists quote_review_responses_quote_submitted_idx
    on public.quote_review_responses (quote_id, submitted_at desc);

alter table public.quote_review_links enable row level security;
alter table public.quote_review_responses enable row level security;

drop policy if exists "Swayphics admins can view quote review links"
    on public.quote_review_links;
create policy "Swayphics admins can view quote review links"
    on public.quote_review_links
    for select
    to authenticated
    using (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can view quote review responses"
    on public.quote_review_responses;
create policy "Swayphics admins can view quote review responses"
    on public.quote_review_responses
    for select
    to authenticated
    using (public.is_swayphics_admin());

revoke all on table public.quote_review_links
    from public, anon, authenticated, service_role;
revoke all on table public.quote_review_responses
    from public, anon, authenticated, service_role;
grant select on table public.quote_review_links to authenticated;
grant select on table public.quote_review_responses to authenticated;

create or replace function public.prevent_quote_review_response_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Quote review responses are immutable.'
        using errcode = '55000';
end;
$function$;

revoke all on function public.prevent_quote_review_response_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_prevent_quote_review_response_mutation
    on public.quote_review_responses;
create trigger trg_prevent_quote_review_response_mutation
before update or delete on public.quote_review_responses
for each row
execute function public.prevent_quote_review_response_mutation();

create or replace function public.admin_issue_swayphics_quote_review(
    p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_proposal_lead_id uuid;
    v_proposal_title text;
    v_version_id uuid;
    v_version_title text;
    v_version_subject text;
    v_version_status text;
    v_current_version integer;
    v_contact_type text;
    v_contact_id uuid;
    v_recipient_email text;
    v_recipient_name text;
    v_business_name text;
    v_email_consent_required boolean := false;
    v_email_consent_status text;
    v_token text;
    v_expires_at timestamptz;
    v_review_link_id uuid;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can issue a proposal review link.'
            using errcode = '42501';
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = p_quote_id
     for update;

    if not found then
        raise exception 'The quote could not be found.'
            using errcode = 'P0002';
    end if;

    if v_quote.status <> 'draft' or v_quote.invoice_id is not null then
        raise exception 'Only an unissued draft quote can be sent for review. Create a revised quote for changes.'
            using errcode = '55000';
    end if;

    if v_quote.proposal_id is null then
        raise exception 'Link this quote to an approved CRM proposal before sending it.'
            using errcode = '23514';
    end if;

    select p.lead_id, p.title, p.current_version,
           pv.id, pv.title, pv.subject, pv.status
      into v_proposal_lead_id, v_proposal_title, v_current_version,
           v_version_id, v_version_title, v_version_subject, v_version_status
      from public.lead_proposals p
      join public.lead_proposal_versions pv
        on pv.proposal_id = p.id
       and pv.version_number = p.current_version
     where p.id = v_quote.proposal_id
       and p.status = 'approved';

    if v_version_id is null or v_version_status <> 'approved' then
        raise exception 'Approve the current proposal revision before sending its commercial quote.'
            using errcode = '55000';
    end if;

    if v_quote.lead_id is not null
       and v_quote.lead_id is distinct from v_proposal_lead_id then
        raise exception 'The quote and proposal must belong to the same lead.'
            using errcode = '23514';
    end if;

    if v_quote.client_id is not null then
        select c.id, c.email, c.contact_name, c.business_name
          into v_contact_id, v_recipient_email, v_recipient_name, v_business_name
          from public.clients c
         where c.id = v_quote.client_id;
        v_contact_type := 'client';
    else
        select l.id, l.email, l.contact_name, l.business_name,
               coalesce(l.email_consent_required, false),
               l.email_consent_status
          into v_contact_id, v_recipient_email, v_recipient_name, v_business_name,
               v_email_consent_required, v_email_consent_status
          from public.leads l
         where l.id = v_proposal_lead_id;
        v_contact_type := 'lead';
    end if;

    if v_contact_id is null then
        raise exception 'The quote must be linked to an existing lead or client.'
            using errcode = '23503';
    end if;

    v_recipient_email := lower(btrim(coalesce(v_recipient_email, '')));
    if v_recipient_email = '' or v_recipient_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
        raise exception 'Add a valid email address to the linked lead or client before sending the proposal.'
            using errcode = '22023';
    end if;

    if v_contact_type = 'lead'
       and v_email_consent_required
       and coalesce(v_email_consent_status, '') <> 'granted' then
        raise exception 'This lead requires recorded email consent before proposal delivery.'
            using errcode = '42501';
    end if;

    if v_quote.valid_until is not null
       and v_quote.valid_until < (now() at time zone 'Africa/Johannesburg')::date then
        raise exception 'This quote has expired. Revise its validity date before sending it.'
            using errcode = '55000';
    end if;

    v_expires_at := least(
        now() + interval '14 days',
        case
            when v_quote.valid_until is null then now() + interval '14 days'
            else (((v_quote.valid_until + 1)::timestamp at time zone 'Africa/Johannesburg') - interval '1 second')
        end
    );

    if v_expires_at <= now() then
        raise exception 'The quote validity period has ended. Update the quote before sending it.'
            using errcode = '55000';
    end if;

    v_token := encode(extensions.gen_random_bytes(32), 'hex');

    update public.quote_review_links
       set revoked_at = now(),
           revoke_reason = 'Superseded by a newly issued proposal review link.'
     where quote_id = v_quote.id
       and revoked_at is null
       and responded_at is null;

    -- The quote is still a draft, so it is safe to bind it to the exact
    -- approved snapshot that will be shown to the recipient.
    update public.quotes
       set proposal_version_id = v_version_id,
           status = 'sent',
           updated_at = now()
     where id = v_quote.id;

    insert into public.quote_review_links (
        quote_id, proposal_version_id, token_hash, recipient_email,
        recipient_name, created_by, expires_at
    ) values (
        v_quote.id,
        v_version_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        v_recipient_email,
        nullif(btrim(coalesce(v_recipient_name, '')), ''),
        auth.uid(),
        v_expires_at
    )
    returning id into v_review_link_id;

    return jsonb_build_object(
        'review_link_id', v_review_link_id,
        'token', v_token,
        'contact_type', v_contact_type,
        'contact_id', v_contact_id,
        'recipient_email', v_recipient_email,
        'recipient_name', coalesce(v_recipient_name, ''),
        'business_name', coalesce(v_business_name, ''),
        'quote_id', v_quote.id,
        'quote_number', v_quote.quote_number,
        'quote_title', v_quote.title,
        'proposal_title', coalesce(v_version_title, v_proposal_title),
        'proposal_subject', v_version_subject,
        'amount', v_quote.amount,
        'monthly_recurring_subtotal', v_quote.monthly_recurring_subtotal,
        'yearly_recurring_subtotal', v_quote.yearly_recurring_subtotal,
        'valid_until', v_quote.valid_until,
        'expires_at', v_expires_at,
        'requires_email_consent', v_email_consent_required
    );
end;
$function$;

create or replace function public.admin_revoke_swayphics_quote_review(
    p_review_link_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_link public.quote_review_links%rowtype;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can revoke a proposal review link.'
            using errcode = '42501';
    end if;

    select *
      into v_link
      from public.quote_review_links l
     where l.id = p_review_link_id
     for update;

    if not found then
        return jsonb_build_object('success', false, 'message', 'Review link not found.');
    end if;

    if v_link.responded_at is not null then
        raise exception 'A proposal with a recorded client response cannot be revoked.'
            using errcode = '55000';
    end if;

    update public.quote_review_links
       set revoked_at = coalesce(revoked_at, now()),
           revoke_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
     where id = v_link.id;

    update public.quotes
       set status = 'draft',
           updated_at = now()
     where id = v_link.quote_id
       and status = 'sent'
       and invoice_id is null;

    return jsonb_build_object('success', true, 'quote_id', v_link.quote_id);
end;
$function$;

create or replace function public.get_swayphics_quote_review(
    p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_link public.quote_review_links%rowtype;
    v_result jsonb;
begin
    if p_token is null or length(btrim(p_token)) < 32 or length(btrim(p_token)) > 512 then
        return jsonb_build_object('ok', false, 'error', 'This proposal link is invalid or has expired.');
    end if;

    select *
      into v_link
      from public.quote_review_links l
     where l.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
       and l.revoked_at is null
       and (l.expires_at > now() or l.responded_at is not null)
     limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'This proposal link is invalid or has expired.');
    end if;

    update public.quote_review_links
       set first_viewed_at = coalesce(first_viewed_at, now())
     where id = v_link.id
       and first_viewed_at is null;

    select jsonb_build_object(
        'ok', true,
        'business_name', coalesce(c.business_name, lead.business_name, ''),
        'recipient_name', coalesce(v_link.recipient_name, c.contact_name, lead.contact_name, ''),
        'recipient_email', v_link.recipient_email,
        'proposal', jsonb_build_object(
            'title', pv.title,
            'subject', pv.subject,
            'content', pv.content,
            'sections', coalesce(pv.structured_content->'sections', '{}'::jsonb)
        ),
        'quote', jsonb_build_object(
            'id', q.id,
            'quote_number', q.quote_number,
            'title', q.title,
            'valid_until', q.valid_until,
            'notes', q.notes,
            'status', q.status,
            'once_off_subtotal', q.once_off_subtotal,
            'monthly_recurring_subtotal', q.monthly_recurring_subtotal,
            'yearly_recurring_subtotal', q.yearly_recurring_subtotal,
            'initial_subtotal', q.initial_subtotal,
            'discount', q.discount,
            'vat_rate', q.vat_rate,
            'vat_amount', q.vat_amount,
            'amount', q.amount,
            'items', coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'service_name', qi.service_name_snapshot,
                        'description', qi.description,
                        'quantity', qi.quantity,
                        'unit_price', qi.unit_price,
                        'line_total', qi.line_total,
                        'billing_interval', qi.billing_interval
                    )
                    order by qi.position, qi.created_at
                )
                from public.quote_items qi
                where qi.quote_id = q.id
            ), '[]'::jsonb)
        ),
        'expires_at', v_link.expires_at,
        'response', (
            select jsonb_build_object(
                'decision', r.decision,
                'respondent_name', r.respondent_name,
                'message', r.message,
                'submitted_at', r.submitted_at
            )
            from public.quote_review_responses r
            where r.review_link_id = v_link.id
        )
    )
      into v_result
      from public.quotes q
      join public.lead_proposal_versions pv
        on pv.id = v_link.proposal_version_id
      left join public.lead_proposals p
        on p.id = q.proposal_id
      left join public.clients c
        on c.id = q.client_id
      left join public.leads lead
        on lead.id = q.lead_id
     where q.id = v_link.quote_id
       and q.proposal_version_id = v_link.proposal_version_id;

    if v_result is null then
        return jsonb_build_object('ok', false, 'error', 'The proposal linked to this review page is no longer available.');
    end if;

    return v_result;
end;
$function$;

create or replace function public.respond_swayphics_quote_review(
    p_token text,
    p_decision text,
    p_respondent_name text,
    p_message text default null,
    p_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_link public.quote_review_links%rowtype;
    v_quote public.quotes%rowtype;
    v_existing public.quote_review_responses%rowtype;
    v_name text;
    v_message text;
    v_response_id uuid;
    v_submitted_at timestamptz;
begin
    if p_token is null or length(btrim(p_token)) < 32 or length(btrim(p_token)) > 512 then
        raise exception 'This proposal link is invalid or has expired.'
            using errcode = '22023';
    end if;

    if p_decision is null or p_decision not in ('accepted', 'rejected') then
        raise exception 'Choose either accept or decline.'
            using errcode = '22023';
    end if;

    v_name := nullif(btrim(coalesce(p_respondent_name, '')), '');
    if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
        raise exception 'Enter your full name (2 to 120 characters).'
            using errcode = '22023';
    end if;

    v_message := nullif(btrim(coalesce(p_message, '')), '');
    if length(coalesce(v_message, '')) > 2000 then
        raise exception 'The response note must be 2,000 characters or fewer.'
            using errcode = '22023';
    end if;

    if p_decision = 'accepted' and p_confirmed is not true then
        raise exception 'Confirm that you are authorised to accept this proposal before continuing.'
            using errcode = '22023';
    end if;

    select *
      into v_link
      from public.quote_review_links l
     where l.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
       and l.revoked_at is null
       and (l.expires_at > now() or l.responded_at is not null)
     for update;

    if not found then
        raise exception 'This proposal link is invalid or has expired.'
            using errcode = '22023';
    end if;

    if v_link.responded_at is not null then
        select *
          into v_existing
          from public.quote_review_responses r
         where r.review_link_id = v_link.id;

        if found then
            return jsonb_build_object(
                'success', true,
                'already_submitted', true,
                'decision', v_existing.decision,
                'quote_id', v_existing.quote_id,
                'submitted_at', v_existing.submitted_at
            );
        end if;
        raise exception 'A response has already been recorded for this proposal.'
            using errcode = '55000';
    end if;

    if v_link.expires_at <= now() then
        raise exception 'This proposal link has expired.'
            using errcode = '55000';
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = v_link.quote_id
     for update;

    if not found or v_quote.status <> 'sent' then
        raise exception 'This quote is no longer awaiting a response.'
            using errcode = '55000';
    end if;

    if v_quote.valid_until is not null
       and v_quote.valid_until < (now() at time zone 'Africa/Johannesburg')::date then
        raise exception 'The quote validity period has ended. Contact Swayphics for an updated proposal.'
            using errcode = '55000';
    end if;

    insert into public.quote_review_responses (
        review_link_id, quote_id, proposal_version_id, decision,
        respondent_name, respondent_email, message
    ) values (
        v_link.id, v_quote.id, v_link.proposal_version_id, p_decision,
        v_name, v_link.recipient_email, v_message
    )
    returning id, submitted_at into v_response_id, v_submitted_at;

    update public.quotes
       set status = p_decision,
           updated_at = now()
     where id = v_quote.id;

    update public.quote_review_links
       set responded_at = v_submitted_at
     where id = v_link.id;

    update public.quote_review_links
       set revoked_at = now(),
           revoke_reason = 'Another valid review link for this quote received a response.'
     where quote_id = v_quote.id
       and id <> v_link.id
       and revoked_at is null
       and responded_at is null;

    return jsonb_build_object(
        'success', true,
        'already_submitted', false,
        'response_id', v_response_id,
        'decision', p_decision,
        'quote_number', v_quote.quote_number,
        'submitted_at', v_submitted_at
    );
end;
$function$;

revoke all on function public.admin_issue_swayphics_quote_review(uuid)
    from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_swayphics_quote_review(uuid, text)
    from public, anon, authenticated, service_role;
revoke all on function public.get_swayphics_quote_review(text)
    from public, anon, authenticated, service_role;
revoke all on function public.respond_swayphics_quote_review(text, text, text, text, boolean)
    from public, anon, authenticated, service_role;

grant execute on function public.admin_issue_swayphics_quote_review(uuid)
    to authenticated;
grant execute on function public.admin_revoke_swayphics_quote_review(uuid, text)
    to authenticated;
grant execute on function public.get_swayphics_quote_review(text)
    to anon, authenticated;
grant execute on function public.respond_swayphics_quote_review(text, text, text, text, boolean)
    to anon, authenticated;

comment on table public.quote_review_links is
    'Expiring, revocable, hashed-token links for external review of one exact Swayphics quote and immutable proposal revision. Independent of client-portal tokens.';
comment on table public.quote_review_responses is
    'Immutable acceptance or rejection records for an externally reviewed Swayphics quote and the exact proposal revision shown to the respondent.';

commit;
