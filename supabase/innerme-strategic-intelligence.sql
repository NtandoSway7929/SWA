-- InnerMe Phase 14: Strategic Intelligence
-- Cross-domain strategic reviews and governed recommendations.
-- Recommendations are candidates only; promotion creates an InnerMe decision candidate
-- and never executes workspace actions.

create table if not exists public.innerme_strategic_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,
  scope text not null default 'swayphics_business',
  period_start date,
  period_end date,
  status text not null default 'draft',
  strategic_posture text,
  executive_summary text not null,
  strengths text,
  constraints text,
  risks text,
  opportunities text,
  cross_domain_signals jsonb not null default '[]'::jsonb,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  recommendation_count integer not null default 0,
  model text,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_strategic_reviews_status_check
    check (status in ('draft','reviewed','approved','archived')),
  constraint innerme_strategic_reviews_signals_check
    check (jsonb_typeof(cross_domain_signals)='array'),
  constraint innerme_strategic_reviews_metrics_check
    check (jsonb_typeof(metrics_snapshot)='object'),
  constraint innerme_strategic_reviews_evidence_check
    check (jsonb_typeof(evidence)='array')
);

create index if not exists innerme_strategic_reviews_status_idx
  on public.innerme_strategic_reviews(status, updated_at desc);

create table if not exists public.innerme_strategic_recommendations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.innerme_strategic_reviews(id) on delete cascade,
  recommendation_key text not null unique,
  rank integer not null default 1,
  title text not null,
  recommendation text not null,
  rationale text not null,
  domains jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  impact text not null default 'medium',
  effort text not null default 'medium',
  urgency text not null default 'normal',
  confidence text not null default 'medium',
  decision_type text not null default 'strategic',
  status text not null default 'candidate',
  decision_candidate_id uuid references public.innerme_decision_candidates(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_strategic_recommendations_rank_check check (rank between 1 and 25),
  constraint innerme_strategic_recommendations_domains_check check (jsonb_typeof(domains)='array'),
  constraint innerme_strategic_recommendations_evidence_check check (jsonb_typeof(evidence)='array'),
  constraint innerme_strategic_recommendations_impact_check check (impact in ('high','medium','low')),
  constraint innerme_strategic_recommendations_effort_check check (effort in ('high','medium','low')),
  constraint innerme_strategic_recommendations_urgency_check check (urgency in ('critical','high','normal','low')),
  constraint innerme_strategic_recommendations_confidence_check check (confidence in ('high','medium','low')),
  constraint innerme_strategic_recommendations_status_check check (status in ('candidate','approved','rejected','promoted'))
);

create index if not exists innerme_strategic_recommendations_review_idx
  on public.innerme_strategic_recommendations(review_id, rank);

create index if not exists innerme_strategic_recommendations_status_idx
  on public.innerme_strategic_recommendations(status, updated_at desc);

alter table public.innerme_strategic_reviews enable row level security;
alter table public.innerme_strategic_recommendations enable row level security;

drop policy if exists "innerme strategic reviews admins can manage" on public.innerme_strategic_reviews;
create policy "innerme strategic reviews admins can manage"
  on public.innerme_strategic_reviews for all to authenticated
  using ((select public.is_swayphics_admin()))
  with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme strategic recommendations admins can manage" on public.innerme_strategic_recommendations;
create policy "innerme strategic recommendations admins can manage"
  on public.innerme_strategic_recommendations for all to authenticated
  using ((select public.is_swayphics_admin()))
  with check ((select public.is_swayphics_admin()));

create or replace function public.review_innerme_strategic_review(
  p_review_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_review public.innerme_strategic_reviews%rowtype;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Admin authentication is required.';
  end if;
  if p_status not in ('reviewed','approved','archived') then
    raise exception 'Invalid strategic review status.';
  end if;

  update public.innerme_strategic_reviews
  set status=p_status,
      reviewed_by=case when p_status in ('reviewed','approved') then auth.uid() else reviewed_by end,
      reviewed_at=case when p_status in ('reviewed','approved') then now() else reviewed_at end,
      updated_at=now()
  where id=p_review_id
  returning * into v_review;

  if not found then
    raise exception 'The strategic review could not be found.';
  end if;

  return jsonb_build_object('ok',true,'review',to_jsonb(v_review));
end;
$$;

create or replace function public.review_innerme_strategic_recommendation(
  p_recommendation_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_rec public.innerme_strategic_recommendations%rowtype;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Admin authentication is required.';
  end if;
  if p_status not in ('approved','rejected') then
    raise exception 'Recommendation review must be approved or rejected.';
  end if;

  select * into v_rec
  from public.innerme_strategic_recommendations
  where id=p_recommendation_id for update;

  if not found then
    raise exception 'The strategic recommendation could not be found.';
  end if;

  if v_rec.status <> 'candidate' then
    return jsonb_build_object('ok',true,'recommendation',to_jsonb(v_rec),'changed',false);
  end if;

  update public.innerme_strategic_recommendations
  set status=p_status,
      approved_by=case when p_status='approved' then auth.uid() else approved_by end,
      approved_at=case when p_status='approved' then now() else approved_at end,
      updated_at=now()
  where id=p_recommendation_id
  returning * into v_rec;

  return jsonb_build_object('ok',true,'recommendation',to_jsonb(v_rec),'changed',true);
end;
$$;

create or replace function public.promote_innerme_strategic_recommendation(
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_rec public.innerme_strategic_recommendations%rowtype;
  v_review public.innerme_strategic_reviews%rowtype;
  v_candidate public.innerme_decision_candidates%rowtype;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Admin authentication is required.';
  end if;

  select * into v_rec
  from public.innerme_strategic_recommendations
  where id=p_recommendation_id for update;

  if not found then
    raise exception 'The strategic recommendation could not be found.';
  end if;

  if v_rec.status <> 'approved' then
    raise exception 'Only an approved strategic recommendation can be promoted.';
  end if;

  if v_rec.decision_candidate_id is not null then
    select * into v_candidate
    from public.innerme_decision_candidates
    where id=v_rec.decision_candidate_id;
    return jsonb_build_object(
      'ok',true,
      'recommendation',to_jsonb(v_rec),
      'decision_candidate',to_jsonb(v_candidate),
      'existing',true
    );
  end if;

  select * into v_review
  from public.innerme_strategic_reviews
  where id=v_rec.review_id;

  if not found then
    raise exception 'The strategic review could not be found.';
  end if;

  insert into public.innerme_decision_candidates (
    candidate_key,title,decision,context,rationale,evidence,expected_impact,
    effort,urgency,confidence,recommended_next_action,source_conversation_id,
    status,created_by,priority
  )
  values (
    'strategic:' || v_rec.id::text,
    v_rec.title,
    v_rec.recommendation,
    v_review.executive_summary,
    v_rec.rationale,
    v_rec.evidence,
    v_rec.impact,
    v_rec.effort,
    v_rec.urgency,
    v_rec.confidence,
    'Review and approve this strategic decision before execution planning.',
    null,
    'candidate',
    auth.uid(),
    greatest(1,least(100,100 - ((v_rec.rank-1)*3)))
  )
  returning * into v_candidate;

  update public.innerme_strategic_recommendations
  set status='promoted',
      decision_candidate_id=v_candidate.id,
      promoted_by=auth.uid(),
      promoted_at=now(),
      updated_at=now()
  where id=v_rec.id
  returning * into v_rec;

  return jsonb_build_object(
    'ok',true,
    'recommendation',to_jsonb(v_rec),
    'decision_candidate',to_jsonb(v_candidate),
    'existing',false
  );
end;
$$;

revoke execute on function public.review_innerme_strategic_review(uuid,text) from public;
revoke execute on function public.review_innerme_strategic_recommendation(uuid,text) from public;
revoke execute on function public.promote_innerme_strategic_recommendation(uuid) from public;

grant execute on function public.review_innerme_strategic_review(uuid,text) to authenticated;
grant execute on function public.review_innerme_strategic_recommendation(uuid,text) to authenticated;
grant execute on function public.promote_innerme_strategic_recommendation(uuid) to authenticated;
