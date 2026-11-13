-- Grant the bank-transfer Edge Function the minimum access it needs
-- to validate portal tokens and update their last-used timestamp.
begin;

grant select on table public.client_portal_tokens to service_role;
grant update (last_used_at) on table public.client_portal_tokens to service_role;

commit;
