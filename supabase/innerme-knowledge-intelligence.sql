-- InnerMe Phase 4E: Knowledge Intelligence
-- Advisory analysis only. Does not mutate knowledge or retrieval state.

create or replace function public.analyze_innerme_knowledge()
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
    result jsonb;
    total_count integer;
    retrievable_count integer;
    stale_count integer;
    unverified_count integer;
    overlap_count integer;
    potential_conflict_count integer;
    feedback_count integer;
    correction_count integer;
    unattributed_count integer;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Admin access required';
    end if;

    select count(*) into total_count from public.innerme_knowledge;

    select count(*) into retrievable_count
    from public.innerme_knowledge k
    where k.status = 'active'
      and k.verification_status = 'verified'
      and (k.review_after is null or k.review_after > now())
      and k.embedding_status = 'ready'
      and k.embedding is not null;

    select count(*) into stale_count
    from public.innerme_knowledge k
    where k.status = 'active'
      and k.review_after is not null
      and k.review_after <= now();

    select count(*) into unverified_count
    from public.innerme_knowledge k
    where k.status = 'active'
      and coalesce(k.verification_status, 'unverified') <> 'verified';

    select count(*) into overlap_count
    from public.innerme_knowledge k1
    join public.innerme_knowledge k2
      on k1.id < k2.id
     and k1.embedding is not null
     and k2.embedding is not null
     and k1.embedding_model = k2.embedding_model
     and 1 - (k1.embedding <=> k2.embedding) >= 0.88
    where k1.status = 'active'
      and k2.status = 'active';

    select count(*) into potential_conflict_count
    from public.innerme_knowledge k1
    join public.innerme_knowledge k2
      on k1.id < k2.id
     and k1.domain = k2.domain
     and k1.knowledge_type = k2.knowledge_type
     and k1.embedding is not null
     and k2.embedding is not null
     and k1.embedding_model = k2.embedding_model
     and 1 - (k1.embedding <=> k2.embedding) between 0.82 and 0.88
     and md5(coalesce(k1.statement, '')) <> md5(coalesce(k2.statement, ''))
    where k1.status = 'active'
      and k2.status = 'active';

    select count(*) into feedback_count from public.innerme_feedback;

    select count(*) into correction_count
    from public.innerme_feedback
    where feedback_type = 'needs_correction'
       or nullif(trim(coalesce(correction, '')), '') is not null;

    select count(*) into unattributed_count
    from public.innerme_feedback
    where knowledge_attribution is null
       or knowledge_attribution = '[]'::jsonb
       or knowledge_attribution = '{}'::jsonb;

    select jsonb_build_object(
        'generated_at', now(),
        'summary', jsonb_build_object(
            'total_knowledge', total_count,
            'retrievable_knowledge', retrievable_count,
            'retrieval_coverage_pct',
                case when total_count = 0 then 0
                     else round((retrievable_count::numeric / total_count::numeric) * 100, 1)
                end,
            'stale_knowledge', stale_count,
            'unverified_knowledge', unverified_count,
            'semantic_overlaps', overlap_count,
            'potential_conflicts', potential_conflict_count,
            'feedback_records', feedback_count,
            'correction_records', correction_count,
            'unattributed_feedback', unattributed_count
        ),
        'coverage_by_domain', coalesce((
            select jsonb_agg(
                jsonb_build_object('domain', x.domain, 'count', x.count, 'retrievable', x.retrievable)
                order by x.count desc, x.domain
            )
            from (
                select
                    coalesce(nullif(trim(k.domain), ''), 'Unclassified') as domain,
                    count(*)::integer as count,
                    count(*) filter (
                        where k.status = 'active'
                          and k.verification_status = 'verified'
                          and (k.review_after is null or k.review_after > now())
                          and k.embedding_status = 'ready'
                          and k.embedding is not null
                    )::integer as retrievable
                from public.innerme_knowledge k
                group by 1
            ) x
        ), '[]'::jsonb),
        'source_authority', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'source', x.name,
                    'authority_level', x.authority_level,
                    'knowledge_count', x.knowledge_count,
                    'authority_score',
                        case x.authority_level when 1 then 100 when 2 then 75 when 3 then 50 else 25 end
                )
                order by x.authority_level asc, x.knowledge_count desc, x.name
            )
            from (
                select s.name, s.authority_level, count(k.id)::integer as knowledge_count
                from public.innerme_knowledge_sources s
                left join public.innerme_knowledge k
                  on k.source_id = s.id and k.status = 'active'
                group by s.id, s.name, s.authority_level
            ) x
        ), '[]'::jsonb),
        'stale_records', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', k.id,
                    'title', k.title,
                    'domain', k.domain,
                    'review_after', k.review_after,
                    'last_verified_at', k.last_verified_at
                )
                order by k.review_after asc
            )
            from (
                select *
                from public.innerme_knowledge
                where status = 'active'
                  and review_after is not null
                  and review_after <= now()
                order by review_after asc
                limit 10
            ) k
        ), '[]'::jsonb),
        'semantic_overlaps', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'left_id', x.left_id,
                    'left_title', x.left_title,
                    'right_id', x.right_id,
                    'right_title', x.right_title,
                    'similarity', round(x.similarity::numeric, 3),
                    'type', case when x.similarity >= 0.94 then 'near_duplicate' else 'strong_overlap' end
                )
                order by x.similarity desc
            )
            from (
                select
                    k1.id left_id, k1.title left_title,
                    k2.id right_id, k2.title right_title,
                    1 - (k1.embedding <=> k2.embedding) similarity
                from public.innerme_knowledge k1
                join public.innerme_knowledge k2
                  on k1.id < k2.id
                 and k1.embedding is not null
                 and k2.embedding is not null
                 and k1.embedding_model = k2.embedding_model
                where k1.status = 'active'
                  and k2.status = 'active'
                  and 1 - (k1.embedding <=> k2.embedding) >= 0.88
                order by (k1.embedding <=> k2.embedding) asc
                limit 10
            ) x
        ), '[]'::jsonb),
        'potential_conflicts', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'left_id', x.left_id,
                    'left_title', x.left_title,
                    'right_id', x.right_id,
                    'right_title', x.right_title,
                    'domain', x.domain,
                    'knowledge_type', x.knowledge_type,
                    'similarity', round(x.similarity::numeric, 3),
                    'review_reason', 'Semantically close records with different statements. Human verification required before treating them as consistent.'
                )
                order by x.similarity desc
            )
            from (
                select
                    k1.id left_id, k1.title left_title,
                    k2.id right_id, k2.title right_title,
                    k1.domain, k1.knowledge_type,
                    1 - (k1.embedding <=> k2.embedding) similarity
                from public.innerme_knowledge k1
                join public.innerme_knowledge k2
                  on k1.id < k2.id
                 and k1.domain = k2.domain
                 and k1.knowledge_type = k2.knowledge_type
                 and k1.embedding is not null
                 and k2.embedding is not null
                 and k1.embedding_model = k2.embedding_model
                 and 1 - (k1.embedding <=> k2.embedding) between 0.82 and 0.88
                 and md5(coalesce(k1.statement, '')) <> md5(coalesce(k2.statement, ''))
                where k1.status = 'active'
                  and k2.status = 'active'
                order by (k1.embedding <=> k2.embedding) asc
                limit 10
            ) x
        ), '[]'::jsonb),
        'feedback_signals', jsonb_build_object(
            'records', feedback_count,
            'corrections', correction_count,
            'unattributed', unattributed_count,
            'retrieval_quality_status',
                case
                    when feedback_count = 0 then 'insufficient_evidence'
                    when correction_count::numeric / greatest(feedback_count, 1) >= 0.25 then 'needs_attention'
                    else 'monitor'
                end
        ),
        'recommendations', (
            select jsonb_agg(value)
            from (
                select case
                    when stale_count > 0 then 'Verify and re-index stale knowledge before relying on it.'
                    when unverified_count > 0 then 'Complete source verification for active knowledge that is not verified.'
                    when overlap_count > 0 then 'Review semantic overlaps and merge or distinguish near-duplicate knowledge where appropriate.'
                    when potential_conflict_count > 0 then 'Review potential knowledge conflicts before adding more material in the affected domains.'
                    when feedback_count = 0 then 'Begin collecting InnerMe feedback so retrieval quality can be measured from real use.'
                    else 'Knowledge health is currently stable. Expand coverage based on recurring unanswered questions.'
                end
                union all
                select case
                    when total_count < 50 then 'Expand the knowledge base deliberately by domain rather than adding broad, unverified material.'
                    else 'Prioritise new knowledge from gaps revealed by retrieval and feedback data.'
                end
            ) recommendations
        )
    ) into result;

    return result;
end;
$$;

revoke all on function public.analyze_innerme_knowledge() from public;
revoke all on function public.analyze_innerme_knowledge() from anon;
grant execute on function public.analyze_innerme_knowledge() to authenticated;
