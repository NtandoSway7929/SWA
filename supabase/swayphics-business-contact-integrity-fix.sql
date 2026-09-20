-- SWAYPHICS BUSINESS / CONTACT DATA INTEGRITY FIX
-- Run once in Supabase SQL Editor.
-- Prevents the enquiry conversion flow from attaching one person's
-- email to the wrong business and refreshes matched CRM records
-- with the current business/contact details.

create or replace function public.convert_swayphics_enquiry_to_lead(
    p_enquiry_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enquiry public.website_enquiries%rowtype;
    v_lead_id uuid;
    v_existing_lead uuid;
    v_days integer;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    select *
    into v_enquiry
    from public.website_enquiries
    where id = p_enquiry_id
    for update;

    if not found then
        raise exception 'Website enquiry could not be found.';
    end if;

    if v_enquiry.converted_lead_id is not null then
        return v_enquiry.converted_lead_id;
    end if;

    select id
    into v_existing_lead
    from public.leads
    where (
        v_enquiry.email is not null
        and nullif(trim(v_enquiry.business_name), '') is not null
        and lower(trim(email)) = lower(trim(v_enquiry.email))
        and lower(trim(business_name)) =
            lower(trim(v_enquiry.business_name))
    )
    or (
        v_enquiry.email is null
        and nullif(trim(v_enquiry.business_name), '') is not null
        and lower(trim(business_name)) =
            lower(trim(v_enquiry.business_name))
    )
    or (
        nullif(trim(v_enquiry.business_name), '') is null
        and v_enquiry.email is not null
        and lower(trim(email)) = lower(trim(v_enquiry.email))
    )
    order by created_at desc
    limit 1;

    select lead_no_response_days
    into v_days
    from public.workflow_settings
    where id = 1;

    if v_existing_lead is not null then
        v_lead_id := v_existing_lead;

        update public.leads
        set
            business_name =
                coalesce(
                    nullif(trim(v_enquiry.business_name), ''),
                    business_name
                ),
            contact_name =
                coalesce(
                    nullif(trim(v_enquiry.name), ''),
                    contact_name
                ),
            email =
                coalesce(
                    nullif(trim(v_enquiry.email), ''),
                    email
                ),
            phone =
                coalesce(
                    nullif(trim(v_enquiry.phone), ''),
                    phone
                ),
            service_interest =
                coalesce(
                    nullif(trim(v_enquiry.service), ''),
                    service_interest
                ),
            status = case
                when status in ('won', 'lost') then 'contacted'
                else 'contacted'
            end,
            last_contacted_at = now(),
            next_follow_up = current_date + coalesce(v_days, 7),
            updated_at = now()
        where id = v_lead_id;
    else
        insert into public.leads (
            business_name,
            contact_name,
            email,
            phone,
            service_interest,
            source,
            status,
            estimated_value,
            assigned_to,
            next_follow_up,
            last_contacted_at,
            notes
        )
        values (
            coalesce(v_enquiry.business_name, v_enquiry.name, 'Website enquiry'),
            v_enquiry.name,
            v_enquiry.email,
            v_enquiry.phone,
            v_enquiry.service,
            'Website',
            'contacted',
            0,
            auth.uid(),
            current_date + coalesce(v_days, 7),
            now(),
            coalesce(v_enquiry.message, '')
        )
        returning id into v_lead_id;
    end if;

    update public.website_enquiries
    set
        status = 'contacted',
        contacted_at = coalesce(contacted_at, now()),
        converted_lead_id = v_lead_id
    where id = p_enquiry_id;

    return v_lead_id;
end;
$$;


create or replace function public.convert_swayphics_lead_to_client(
    p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead public.leads%rowtype;
    v_client_id uuid;
    v_existing_client uuid;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    select *
    into v_lead
    from public.leads
    where id = p_lead_id
    for update;

    if not found then
        raise exception 'Lead could not be found.';
    end if;

    if v_lead.converted_client_id is not null then
        return v_lead.converted_client_id;
    end if;

    select id
    into v_existing_client
    from public.clients
    where (
        v_lead.email is not null
        and nullif(trim(v_lead.business_name), '') is not null
        and lower(trim(email)) = lower(trim(v_lead.email))
        and lower(trim(business_name)) =
            lower(trim(v_lead.business_name))
    )
    or (
        v_lead.email is null
        and nullif(trim(v_lead.business_name), '') is not null
        and lower(trim(business_name)) =
            lower(trim(v_lead.business_name))
    )
    or (
        nullif(trim(v_lead.business_name), '') is null
        and v_lead.email is not null
        and lower(trim(email)) = lower(trim(v_lead.email))
    )
    order by created_at desc
    limit 1;

    if v_existing_client is not null then
        v_client_id := v_existing_client;

        update public.clients
        set
            business_name =
                coalesce(
                    nullif(trim(v_lead.business_name), ''),
                    business_name
                ),
            contact_name =
                coalesce(
                    nullif(trim(v_lead.contact_name), ''),
                    contact_name
                ),
            email =
                coalesce(
                    nullif(trim(v_lead.email), ''),
                    email
                ),
            phone =
                coalesce(
                    nullif(trim(v_lead.phone), ''),
                    phone
                ),
            status = 'active',
            source_lead_id = p_lead_id,
            updated_at = now()
        where id = v_client_id;
    else
        insert into public.clients (
            business_name,
            contact_name,
            email,
            phone,
            status,
            assigned_to,
            notes,
            source_lead_id
        )
        values (
            v_lead.business_name,
            v_lead.contact_name,
            v_lead.email,
            v_lead.phone,
            'active',
            coalesce(v_lead.assigned_to, auth.uid()),
            v_lead.notes,
            p_lead_id
        )
        returning id into v_client_id;
    end if;

    update public.leads
    set
        status = 'won',
        converted_client_id = v_client_id,
        next_follow_up = null,
        updated_at = now()
    where id = p_lead_id;

    return v_client_id;
end;
$$;


notify pgrst, 'reload schema';
