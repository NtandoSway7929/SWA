-- Add a distinct, privacy-minimal telemetry category for InnerMe proposal drafting.
-- Existing records remain valid; proposal text and assessment data are never stored here.

alter table public.innerme_provider_usage
  drop constraint if exists innerme_provider_usage_task_category_check;

alter table public.innerme_provider_usage
  add constraint innerme_provider_usage_task_category_check
  check (task_category in ('copywriting', 'assistant_chat', 'proposal_draft'));

comment on column public.innerme_provider_usage.task_category is
  'Task category for provider-attempt telemetry. Contains routing metadata only; proposal_draft does not store generated proposal content.';
