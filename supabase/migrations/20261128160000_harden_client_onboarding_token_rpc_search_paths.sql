begin;

-- These token-authenticated client onboarding RPCs intentionally remain callable
-- by anon and authenticated roles. All relation references are schema-qualified,
-- and built-in PostgreSQL functions resolve through pg_catalog.
-- Pin the function search path to prevent object-shadowing attacks without
-- changing token validation, grants, or application behaviour.

alter function public.get_client_onboarding(text)
  set search_path = '';

alter function public.get_client_onboarding_assets(text)
  set search_path = '';

alter function public.save_client_onboarding(text, jsonb, boolean)
  set search_path = '';

commit;
