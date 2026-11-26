create or replace function public.convert_business_assessment_to_lead(
    p_assessment_id uuid,
    p_action text,
    p_existing_lead_id uuid default null,
    p_business_name_override text default null,
    p_confirm_create_new boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_admin_user_id uuid := auth.uid();
    v_assessment public.business_assessments%rowtype;
    v_enquiry public.website_enquiries%rowtype;
    v_business_name text;
    v_business_key text;
    v_email text;
    v_phone text;
    v_lock_key bigint;
    v_matches jsonb := '[]'::jsonb;
    v_existing_lead public.leads%rowtype;
    v_lead_id uuid;
    v_service_interest text;
    v_priority text;
    v_website_status text;
    v_finding_titles text;
    v_notes text;
begin
    if v_admin_user_id is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics administrator access required.'
            using errcode = '42501';
    end if;

    if p_assessment_id is null then
        raise exception 'Assessment reference is required.'
            using errcode = '22023';
    end if;

    if p_action not in ('preview', 'link_existing', 'create_new') then
        raise exception 'Choose a valid assessment conversion action.'
            using errcode = '22023';
    end if;

    if p_business_name_override is not null
       and length(btrim(p_business_name_override)) > 150 then
        raise exception 'The business name is too long.'
            using errcode = '22023';
    end if;

    select *
      into v_assessment
      from public.business_assessments
     where id = p_assessment_id
     for update;

    if not found then
        raise exception 'Business assessment could not be found.'
            using errcode = 'P0002';
    end if;

    if v_assessment.lead_id is not null then
        return jsonb_build_object(
            'status', 'already_converted',
            'assessment_id', v_assessment.id,
            'lead_id', v_assessment.lead_id
        );
    end if;

    if not v_assessment.contact_requested then
        return jsonb_build_object(
            'status', 'contact_not_requested',
            'message', 'Only respondents who requested contact can be converted into a lead.'
        );
    end if;

    select *
      into v_enquiry
      from public.website_enquiries
     where assessment_id = v_assessment.id
     for update;

    if not found then
        return jsonb_build_object(
            'status', 'contact_request_missing',
            'message', 'The linked contact request could not be found.'
        );
    end if;

    if v_enquiry.converted_lead_id is not null then
        update public.business_assessments
           set lead_id = v_enquiry.converted_lead_id,
               status = 'converted',
               updated_at = now()
         where id = v_assessment.id;

        return jsonb_build_object(
            'status', 'already_converted',
            'assessment_id', v_assessment.id,
            'lead_id', v_enquiry.converted_lead_id
        );
    end if;

    v_email := nullif(lower(btrim(coalesce(v_enquiry.email, ''))), '');
    v_phone := nullif(regexp_replace(coalesce(v_enquiry.phone, ''), '[^0-9]', '', 'g'), '');
    v_business_key := nullif(
        lower(regexp_replace(
            btrim(coalesce(v_assessment.business_name, v_enquiry.business_name, '')),
            '\s+',
            ' ',
            'g'
        )),
        ''
    );

    /*
     * Serialize conversions for shared contact/business identifiers. Sorted
     * advisory locks prevent opposite lock order when two enquiries share more
     * than one identifier.
     */
    for v_lock_key in
        select distinct pg_catalog.hashtextextended(identity_value, 0)
          from pg_catalog.unnest(array[
              case when v_email is not null then 'email:' || v_email end,
              case when v_phone is not null and length(v_phone) >= 6 then 'phone:' || v_phone end,
              case when v_business_key is not null then 'business:' || v_business_key end
          ]) as identities(identity_value)
         where identity_value is not null
         order by 1
    loop
        perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
    end loop;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', candidate.id,
                'business_name', candidate.business_name,
                'contact_name', candidate.contact_name,
                'email', candidate.email,
                'phone', candidate.phone,
                'source', candidate.source,
                'status', candidate.status,
                'created_at', candidate.created_at,
                'matching_reasons', candidate.matching_reasons
            )
            order by candidate.created_at desc
        ),
        '[]'::jsonb
    )
    into v_matches
    from (
        select
            l.id,
            l.business_name,
            l.contact_name,
            l.email,
            l.phone,
            l.source,
            l.status,
            l.created_at,
            array_remove(array[
                case
                    when v_email is not null
                     and lower(btrim(coalesce(l.email, ''))) = v_email
                    then 'email'
                end,
                case
                    when v_phone is not null
                     and length(v_phone) >= 6
                     and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = v_phone
                    then 'phone'
                end,
                case
                    when v_business_key is not null
                     and lower(regexp_replace(btrim(coalesce(l.business_name, '')), '\s+', ' ', 'g')) = v_business_key
                    then 'business name'
                end
            ], null) as matching_reasons
        from public.leads as l
        where (
            v_email is not null
            and lower(btrim(coalesce(l.email, ''))) = v_email
        ) or (
            v_phone is not null
            and length(v_phone) >= 6
            and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = v_phone
        ) or (
            v_business_key is not null
            and lower(regexp_replace(btrim(coalesce(l.business_name, '')), '\s+', ' ', 'g')) = v_business_key
        )
        order by l.created_at desc
        limit 10
    ) as candidate;

    if p_action = 'preview' then
        return jsonb_build_object(
            'status', case when jsonb_array_length(v_matches) > 0 then 'possible_matches' else 'ready_to_create' end,
            'assessment_id', v_assessment.id,
            'business_name_required', nullif(btrim(coalesce(v_assessment.business_name, '')), '') is null,
            'matches', v_matches
        );
    end if;

    if p_action = 'link_existing' then
        if p_existing_lead_id is null then
            raise exception 'Choose an existing lead to link.'
                using errcode = '22023';
        end if;

        select *
          into v_existing_lead
          from public.leads as l
         where l.id = p_existing_lead_id
           and (
               (v_email is not null and lower(btrim(coalesce(l.email, ''))) = v_email)
               or (
                   v_phone is not null
                   and length(v_phone) >= 6
                   and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = v_phone
               )
               or (
                   v_business_key is not null
                   and lower(regexp_replace(btrim(coalesce(l.business_name, '')), '\s+', ' ', 'g')) = v_business_key
               )
           )
         for update;

        if not found then
            return jsonb_build_object(
                'status', 'lead_not_a_matching_candidate',
                'message', 'The selected lead no longer matches this assessment contact request. Refresh the match list.'
            );
        end if;

        update public.business_assessments
           set lead_id = v_existing_lead.id,
               status = 'converted',
               updated_at = now()
         where id = v_assessment.id;

        update public.website_enquiries
           set converted_lead_id = v_existing_lead.id,
               status = 'converted'
         where id = v_enquiry.id;

        return jsonb_build_object(
            'status', 'linked_existing',
            'assessment_id', v_assessment.id,
            'enquiry_id', v_enquiry.id,
            'lead_id', v_existing_lead.id,
            'lead_name', v_existing_lead.business_name,
            'lead_status_preserved', v_existing_lead.status,
            'lead_source_preserved', v_existing_lead.source
        );
    end if;

    if p_action = 'create_new' then
        if p_confirm_create_new is not true then
            return jsonb_build_object(
                'status', 'confirmation_required',
                'matches', v_matches,
                'message', 'Confirm that a separate new lead should be created.'
            );
        end if;

        v_business_name := coalesce(
            nullif(btrim(coalesce(v_assessment.business_name, '')), ''),
            nullif(btrim(coalesce(p_business_name_override, '')), '')
        );

        if v_business_name is null or length(v_business_name) < 2 then
            return jsonb_build_object(
                'status', 'business_name_required',
                'message', 'Enter the correct business name before creating a lead.'
            );
        end if;

        select nullif(
            string_agg(
                nullif(btrim(recommendation.item ->> 'title'), ''),
                '; ' order by recommendation.ordinality
            ),
            ''
        )
        into v_service_interest
        from jsonb_array_elements(
            case
                when jsonb_typeof(v_assessment.report -> 'recommendations') = 'array'
                    then v_assessment.report -> 'recommendations'
                else '[]'::jsonb
            end
        ) with ordinality as recommendation(item, ordinality);

        v_priority := nullif(btrim(coalesce(
            v_assessment.report #>> '{priority,label}',
            ''
        )), '');
        v_website_status := nullif(btrim(coalesce(
            v_assessment.report ->> 'website_status',
            ''
        )), '');

        select nullif(
            string_agg(
                nullif(btrim(finding.item ->> 'title'), ''),
                '; ' order by finding.ordinality
            ),
            ''
        )
        into v_finding_titles
        from jsonb_array_elements(
            case
                when jsonb_typeof(v_assessment.findings) = 'array'
                    then v_assessment.findings
                else '[]'::jsonb
            end
        ) with ordinality as finding(item, ordinality);

        v_notes := concat_ws(
            E'\n',
            'Created from a Business Opportunity Finder contact request.',
            'Assessment reference: ' || v_assessment.id::text,
            'Assessment version: ' || v_assessment.assessment_version,
            case when v_priority is not null then 'Respondent priority: ' || v_priority end,
            case when v_website_status is not null then 'Website status: ' || v_website_status end,
            case when v_finding_titles is not null then 'Self-reported opportunities: ' || v_finding_titles end,
            'This conversion does not record or infer an outreach attempt.'
        );

        insert into public.leads (
            business_name,
            contact_name,
            email,
            phone,
            service_interest,
            source,
            status,
            assigned_to,
            notes
        )
        values (
            v_business_name,
            nullif(btrim(coalesce(v_enquiry.name, '')), ''),
            v_email,
            nullif(btrim(coalesce(v_enquiry.phone, '')), ''),
            v_service_interest,
            'Business Opportunity Finder',
            'new',
            v_admin_user_id,
            v_notes
        )
        returning id into v_lead_id;

        update public.business_assessments
           set lead_id = v_lead_id,
               status = 'converted',
               updated_at = now()
         where id = v_assessment.id;

        update public.website_enquiries
           set converted_lead_id = v_lead_id,
               status = 'converted'
         where id = v_enquiry.id;

        return jsonb_build_object(
            'status', 'created',
            'assessment_id', v_assessment.id,
            'enquiry_id', v_enquiry.id,
            'lead_id', v_lead_id,
            'lead_status', 'new',
            'lead_source', 'Business Opportunity Finder',
            'last_contacted_at', null
        );
    end if;

    raise exception 'Unsupported Business Opportunity Finder conversion action.'
        using errcode = '22023';
end;
$function$;

revoke all on function public.convert_business_assessment_to_lead(uuid, text, uuid, text, boolean)
    from public, anon, authenticated;
grant execute on function public.convert_business_assessment_to_lead(uuid, text, uuid, text, boolean)
    to authenticated;
