-- Phase 29 security hardening:
-- Keep privileged implementations outside the exposed public API schema.
-- Public RPCs remain SECURITY INVOKER wrappers and table writes remain RPC-gated.

create schema if not exists innerme_private;
revoke all on schema innerme_private from public, anon;
grant usage on schema innerme_private to authenticated;

alter function public.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb)
    set schema innerme_private;
alter function public.review_innerme_agent_trust_evidence(uuid,text)
    set schema innerme_private;
alter function public.refresh_innerme_agent_trust_calibration()
    set schema innerme_private;
alter function public.review_innerme_trust_calibration(uuid,text)
    set schema innerme_private;

revoke all on function innerme_private.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) from public, anon;
revoke all on function innerme_private.review_innerme_agent_trust_evidence(uuid,text) from public, anon;
revoke all on function innerme_private.refresh_innerme_agent_trust_calibration() from public, anon;
revoke all on function innerme_private.review_innerme_trust_calibration(uuid,text) from public, anon;
grant execute on function innerme_private.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) to authenticated;
grant execute on function innerme_private.review_innerme_agent_trust_evidence(uuid,text) to authenticated;
grant execute on function innerme_private.refresh_innerme_agent_trust_calibration() to authenticated;
grant execute on function innerme_private.review_innerme_trust_calibration(uuid,text) to authenticated;

create or replace function public.record_innerme_agent_trust_evidence(
    p_agent_id uuid,
    p_source_type text,
    p_source_record_id uuid,
    p_outcome_signal text,
    p_confidence text,
    p_quality_score integer,
    p_summary text,
    p_evidence jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = public
as $$
    select innerme_private.record_innerme_agent_trust_evidence(
        p_agent_id,p_source_type,p_source_record_id,p_outcome_signal,
        p_confidence,p_quality_score,p_summary,p_evidence
    );
$$;

create or replace function public.review_innerme_agent_trust_evidence(
    p_evidence_id uuid,
    p_decision text
)
returns boolean
language sql
security invoker
set search_path = public
as $$
    select innerme_private.review_innerme_agent_trust_evidence(p_evidence_id,p_decision);
$$;

create or replace function public.refresh_innerme_agent_trust_calibration()
returns integer
language sql
security invoker
set search_path = public
as $$
    select innerme_private.refresh_innerme_agent_trust_calibration();
$$;

create or replace function public.review_innerme_trust_calibration(
    p_calibration_id uuid,
    p_decision text
)
returns boolean
language sql
security invoker
set search_path = public
as $$
    select innerme_private.review_innerme_trust_calibration(p_calibration_id,p_decision);
$$;

revoke all on function public.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) from public, anon;
revoke all on function public.review_innerme_agent_trust_evidence(uuid,text) from public, anon;
revoke all on function public.refresh_innerme_agent_trust_calibration() from public, anon;
revoke all on function public.review_innerme_trust_calibration(uuid,text) from public, anon;
grant execute on function public.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) to authenticated;
grant execute on function public.review_innerme_agent_trust_evidence(uuid,text) to authenticated;
grant execute on function public.refresh_innerme_agent_trust_calibration() to authenticated;
grant execute on function public.review_innerme_trust_calibration(uuid,text) to authenticated;

notify pgrst,'reload schema';
