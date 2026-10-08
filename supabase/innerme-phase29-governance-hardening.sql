-- Phase 29 hardening: cover new audit-table foreign keys.
create index if not exists idx_innerme_agent_trust_evidence_verified_by
on public.innerme_agent_trust_evidence(verified_by);

create index if not exists idx_innerme_trust_calibration_reviews_reviewed_by
on public.innerme_trust_calibration_reviews(reviewed_by);

notify pgrst,'reload schema';
