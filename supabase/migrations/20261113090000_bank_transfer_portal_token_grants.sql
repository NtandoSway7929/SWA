-- Grant the bank-transfer Edge Function the minimum access it needs
-- to validate portal tokens and update their last-used timestamp.
-- Remove any pre-existing table-level UPDATE grant first: it would override
-- the intended column-level restriction on token activation and other fields.
begin;

revoke update on table public.client_portal_tokens from service_role;
grant select on table public.client_portal_tokens to service_role;
grant update (last_used_at) on table public.client_portal_tokens to service_role;

commit;
