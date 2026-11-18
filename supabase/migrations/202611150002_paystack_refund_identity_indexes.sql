-- Track the additional Paystack refund identity protections that were
-- applied to the isolated QA project during refund lifecycle hardening.
-- Provider IDs and webhook event IDs must identify at most one refund row.

begin;

create unique index if not exists payment_refunds_provider_refund_uidx
  on public.payment_refunds(provider, environment, provider_refund_id)
  where provider_refund_id is not null;

create unique index if not exists payment_refunds_provider_event_uidx
  on public.payment_refunds(provider, environment, provider_event_id)
  where provider_event_id is not null;

commit;
