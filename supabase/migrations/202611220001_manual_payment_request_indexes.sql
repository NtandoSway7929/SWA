begin;
create index if not exists manual_payment_record_requests_invoice_idx
  on public.manual_payment_record_requests(invoice_id, created_at desc);
create index if not exists manual_payment_record_requests_recorded_by_idx
  on public.manual_payment_record_requests(recorded_by, created_at desc);
commit;
