-- Accepted quote sales handoff: agreement snapshot, lead-to-client conversion,
-- and a controlled client link for accepted commercial quotes.
begin;

create sequence if not exists public.swayphics_agreement_number_seq
    start with 1 increment by 1;

alter table public.quote_review_responses
    add column if not exists terms_accepted boolean not null default false,
    add column if not exists terms_url text,
    add column if not exists terms_document_sha text,
    add column if not exists acceptance_statement text;

create table if not exists public.swayphics_project_agreements (
    id uuid primary key default gen_random_uuid(),
    agreement_number text not null unique default (
        'SWA-AGR-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_agreement_number_seq')::text, 4, '0')
    ),
    quote_id uuid not null unique
        references public.quotes(id) on delete restrict,
    review_response_id uuid not null unique
        references public.quote_review_responses(id) on delete restrict,
    proposal_id uuid not null
        references public.lead_proposals(id) on delete restrict,
    proposal_version_id uuid not null
        references public.lead_proposal_versions(id) on delete restrict,
    lead_id uuid references public.leads(id) on delete set null,
    client_id uuid references public.clients(id) on delete set null,
    agreement_title text not null,
    proposal_snapshot jsonb not null
        check (jsonb_typeof(proposal_snapshot) = 'object'),
    commercial_snapshot jsonb not null
        check (jsonb_typeof(commercial_snapshot) = 'object'),
    terms_url text not null,
    terms_document_sha text not null,
    terms_acceptance_statement text not null,
    accepted_by_name text not null,
    accepted_by_email text not null,
    accepted_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists swayphics_project_agreements_client_accepted_idx
    on public.swayphics_project_agreements (client_id, accepted_at desc);

create index if not exists swayphics_project_agreements_lead_accepted_idx
    on public.swayphics_project_agreements (lead_id, accepted_at desc);

alter table public.swayphics_project_agreements enable row level security;

drop policy if exists "Swayphics admins can view accepted project agreements"
    on public.swayphics_project_agreements;
create policy "Swayphics admins can view accepted project agreements"
    on public.swayphics_project_agreements
    for select
    to authenticated
    using (public.is_swayphics_admin());

revoke all on table public.swayphics_project_agreements
    from public, anon, authenticated, service_role;
grant select on table public.swayphics_project_agreements to authenticated;

create or replace function public.create_swayphics_project_agreement_from_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_proposal_version public.lead_proposal_versions%rowtype;
    v_terms_statement text;
begin
    if new.decision <> 'accepted' or new.terms_accepted is not true then
        return new;
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = new.quote_id;

    if not found then
        raise exception 'The accepted quotation could not be found.'
            using errcode = '23503';
    end if;

    select *
      into v_proposal_version
      from public.lead_proposal_versions pv
     where pv.id = new.proposal_version_id
       and pv.proposal_id = v_quote.proposal_id;

    if not found then
        raise exception 'The approved proposal revision for this acceptance could not be found.'
            using errcode = '23503';
    end if;

    v_terms_statement := coalesce(
        nullif(btrim(new.acceptance_statement), ''),
        'I confirm that I am authorised to accept this proposal on behalf of the business and agree to the proposal, commercial quotation and Swayphics Terms & Conditions.'
    );

    insert into public.swayphics_project_agreements (
        quote_id,
        review_response_id,
        proposal_id,
        proposal_version_id,
        lead_id,
        client_id,
        agreement_title,
        proposal_snapshot,
        commercial_snapshot,
        terms_url,
        terms_document_sha,
        terms_acceptance_statement,
        accepted_by_name,
        accepted_by_email,
        accepted_at
    ) values (
        v_quote.id,
        new.id,
        v_quote.proposal_id,
        v_proposal_version.id,
        v_quote.lead_id,
        v_quote.client_id,
        coalesce(nullif(btrim(v_proposal_version.title), ''), v_quote.title),
        jsonb_build_object(
            'title', v_proposal_version.title,
            'subject', v_proposal_version.subject,
            'content', v_proposal_version.content,
            'structured_content', v_proposal_version.structured_content,
            'version_number', v_proposal_version.version_number,
            'proposal_version_id', v_proposal_version.id
        ),
        jsonb_build_object(
            'quote_number', v_quote.quote_number,
            'title', v_quote.title,
            'valid_until', v_quote.valid_until,
            'notes', v_quote.notes,
            'once_off_subtotal', v_quote.once_off_subtotal,
            'monthly_recurring_subtotal', v_quote.monthly_recurring_subtotal,
            'yearly_recurring_subtotal', v_quote.yearly_recurring_subtotal,
            'initial_subtotal', v_quote.initial_subtotal,
            'discount', v_quote.discount,
            'vat_rate', v_quote.vat_rate,
            'vat_amount', v_quote.vat_amount,
            'initial_amount_due', v_quote.amount,
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
                where qi.quote_id = v_quote.id
            ), '[]'::jsonb)
        ),
        coalesce(new.terms_url, 'https://swayphics.co.za/terms-and-conditions/revisions/fa302aec3ab9fd2e8e6458f53726f48cae765e5e/'),
        coalesce(new.terms_document_sha, 'e56d3f2fd1e4247dcff5bd40c9340542b1e414fc'),
        v_terms_statement,
        new.respondent_name,
        new.respondent_email,
        new.submitted_at
    )
    on conflict (quote_id) do nothing;

    return new;
end;
$function$;

revoke all on function public.create_swayphics_project_agreement_from_response()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_create_swayphics_project_agreement_from_response
    on public.quote_review_responses;
create trigger trg_create_swayphics_project_agreement_from_response
after insert on public.quote_review_responses
for each row
execute function public.create_swayphics_project_agreement_from_response();

create or replace function public.prevent_swayphics_project_agreement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_op = 'DELETE' then
        raise exception 'Accepted project agreement records are immutable.'
            using errcode = '55000';
    end if;

    if old.client_id is null
       and new.client_id is not null
       and current_setting('swayphics.agreement_client_conversion', true) = 'on'
       and exists (
            select 1
              from public.quotes q
             where q.id = old.quote_id
               and q.client_id = new.client_id
       )
       and (to_jsonb(new) - 'client_id') = (to_jsonb(old) - 'client_id') then
        return new;
    end if;

    raise exception 'Accepted project agreement records are immutable.'
        using errcode = '55000';
end;
$function$;

revoke all on function public.prevent_swayphics_project_agreement_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_prevent_swayphics_project_agreement_mutation
    on public.swayphics_project_agreements;
create trigger trg_prevent_swayphics_project_agreement_mutation
before update or delete on public.swayphics_project_agreements
for each row
execute function public.prevent_swayphics_project_agreement_mutation();

-- The accepted quote may be linked to a client only through the dedicated
-- administrator RPC below. Commercial values and proposal references remain
-- frozen after acceptance.
create or replace function public.guard_swayphics_quote_commercial_record()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_op = 'DELETE' then
        if old.invoice_id is not null then
            raise exception 'A quote linked to an invoice cannot be deleted.'
                using errcode = '55000';
        end if;
        return old;
    end if;

    if old.status <> 'draft' then
        if new.title is distinct from old.title
           or (new.lead_id is distinct from old.lead_id and new.lead_id is not null)
           or (
                new.client_id is distinct from old.client_id
                and new.client_id is not null
                and not (
                    old.client_id is null
                    and old.status = 'accepted'
                    and new.status = 'accepted'
                    and current_setting('swayphics.quote_client_conversion', true) = 'on'
                )
           )
           or (new.proposal_id is distinct from old.proposal_id and new.proposal_id is not null)
           or (new.proposal_version_id is distinct from old.proposal_version_id and new.proposal_version_id is not null)
           or new.valid_until is distinct from old.valid_until
           or new.notes is distinct from old.notes
           or new.amount is distinct from old.amount
           or new.once_off_subtotal is distinct from old.once_off_subtotal
           or new.monthly_recurring_subtotal is distinct from old.monthly_recurring_subtotal
           or new.yearly_recurring_subtotal is distinct from old.yearly_recurring_subtotal
           or new.initial_subtotal is distinct from old.initial_subtotal
           or new.discount is distinct from old.discount
           or new.vat_rate is distinct from old.vat_rate
           or new.vat_amount is distinct from old.vat_amount then
            raise exception 'Only draft quotes can be edited. Create a new quote for changes.'
                using errcode = '55000';
        end if;
    end if;

    if new.invoice_id is distinct from old.invoice_id
       and current_setting('swayphics.quote_invoice_conversion', true) is distinct from 'on' then
        raise exception 'Quote-to-invoice links can only be created by the atomic conversion workflow.'
            using errcode = '55000';
    end if;

    return new;
end;
$function$;

revoke all on function public.guard_swayphics_quote_commercial_record()
    from public, anon, authenticated, service_role;

-- Invoice creation remains in the existing public.admin_create_invoice_from_quote(uuid)
-- RPC from the quote-pricing milestone; this migration does not duplicate billing logic.
create or replace function public.admin_convert_accepted_quote_to_client(
    p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_lead public.leads%rowtype;
    v_client_id uuid;
    v_agreement_id uuid;
    v_agreement_number text;
    v_business_name text;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can convert an accepted quote to a client.'
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

    if v_quote.status <> 'accepted' then
        raise exception 'Only an accepted quote can be converted into a client record.'
            using errcode = '55000';
    end if;

    if v_quote.client_id is not null then
        v_client_id := v_quote.client_id;
    else
        if not exists (
            select 1
              from public.swayphics_project_agreements a
             where a.quote_id = v_quote.id
               and a.proposal_version_id = v_quote.proposal_version_id
               and nullif(btrim(a.terms_acceptance_statement), '') is not null
        ) then
            raise exception 'A recorded client acceptance and Terms & Conditions acknowledgement are required before converting this quote into a client.'
                using errcode = '55000';
        end if;

        if v_quote.lead_id is null then
            raise exception 'This accepted quote is not linked to a lead that can be converted.'
                using errcode = '23514';
        end if;

        select *
          into v_lead
          from public.leads l
         where l.id = v_quote.lead_id
         for update;

        if not found then
            raise exception 'The lead linked to this accepted quote could not be found.'
                using errcode = '23503';
        end if;

        v_client_id := coalesce(
            v_lead.converted_client_id,
            public.convert_swayphics_lead_to_client(v_lead.id)
        );

        if v_client_id is null then
            raise exception 'The lead-to-client conversion did not return a client record.'
                using errcode = '23514';
        end if;

        perform pg_catalog.set_config('swayphics.quote_client_conversion', 'on', true);

        update public.quotes
           set client_id = v_client_id,
               updated_at = now()
         where id = v_quote.id
           and client_id is null;

        perform pg_catalog.set_config('swayphics.quote_client_conversion', 'off', true);
    end if;

    perform pg_catalog.set_config('swayphics.agreement_client_conversion', 'on', true);

    update public.swayphics_project_agreements
       set client_id = v_client_id
     where quote_id = v_quote.id
       and client_id is null;

    perform pg_catalog.set_config('swayphics.agreement_client_conversion', 'off', true);

    select c.business_name
      into v_business_name
      from public.clients c
     where c.id = v_client_id;

    select a.id, a.agreement_number
      into v_agreement_id, v_agreement_number
      from public.swayphics_project_agreements a
     where a.quote_id = v_quote.id;

    return jsonb_build_object(
        'success', true,
        'quote_id', v_quote.id,
        'client_id', v_client_id,
        'business_name', coalesce(v_business_name, ''),
        'agreement_id', v_agreement_id,
        'agreement_number', v_agreement_number,
        'already_converted', v_quote.client_id is not null
    );
end;
$function$;

revoke all on function public.admin_convert_accepted_quote_to_client(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.admin_convert_accepted_quote_to_client(uuid)
    to authenticated;

-- Preserve the original proposal-response contract while recording explicit
-- acknowledgement of the published Swayphics Terms & Conditions.
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
                'submitted_at', r.submitted_at,
                'terms_accepted', r.terms_accepted,
                'terms_url', r.terms_url,
                'terms_document_sha', r.terms_document_sha,
                'acceptance_statement', r.acceptance_statement
            )
            from public.quote_review_responses r
            where r.review_link_id = v_link.id
        )
    )
      into v_result
      from public.quotes q
      join public.lead_proposal_versions pv
        on pv.id = v_link.proposal_version_id
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

revoke all on function public.get_swayphics_quote_review(text)
    from public, anon, authenticated, service_role;
grant execute on function public.get_swayphics_quote_review(text)
    to anon, authenticated;

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
    v_terms_url text := 'https://swayphics.co.za/terms-and-conditions/revisions/fa302aec3ab9fd2e8e6458f53726f48cae765e5e/';
    v_terms_sha text := 'e56d3f2fd1e4247dcff5bd40c9340542b1e414fc';
    v_acceptance_statement text :=
        'I confirm that I am authorised to accept this proposal on behalf of the business and agree to the proposal, commercial quotation and Swayphics Terms & Conditions.';
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
        raise exception 'Confirm that you are authorised to accept this proposal and agree to the Swayphics Terms & Conditions before continuing.'
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
                'submitted_at', v_existing.submitted_at,
                'terms_accepted', v_existing.terms_accepted,
                'terms_url', v_existing.terms_url,
                'terms_document_sha', v_existing.terms_document_sha,
                'acceptance_statement', v_existing.acceptance_statement
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
        respondent_name, respondent_email, message,
        terms_accepted, terms_url, terms_document_sha, acceptance_statement
    ) values (
        v_link.id, v_quote.id, v_link.proposal_version_id, p_decision,
        v_name, v_link.recipient_email, v_message,
        p_decision = 'accepted',
        case when p_decision = 'accepted' then v_terms_url else null end,
        case when p_decision = 'accepted' then v_terms_sha else null end,
        case when p_decision = 'accepted' then v_acceptance_statement else null end
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
        'submitted_at', v_submitted_at,
        'terms_accepted', p_decision = 'accepted',
        'terms_url', case when p_decision = 'accepted' then v_terms_url else null end,
        'terms_document_sha', case when p_decision = 'accepted' then v_terms_sha else null end,
        'acceptance_statement', case when p_decision = 'accepted' then v_acceptance_statement else null end
    );
end;
$function$;

revoke all on function public.respond_swayphics_quote_review(text, text, text, text, boolean)
    from public, anon, authenticated, service_role;
grant execute on function public.respond_swayphics_quote_review(text, text, text, text, boolean)
    to anon, authenticated;

comment on table public.swayphics_project_agreements is
    'Immutable accepted project agreements assembled from an exact proposal revision, itemised quote, respondent decision and acknowledged Terms & Conditions. Client association may be attached once during an authenticated accepted-quote conversion.';

notify pgrst, 'reload schema';

commit;
