begin;

-- This public token-authenticated portal RPC intentionally remains callable
-- without an authenticated session. Its table and extension references are
-- schema-qualified, so an empty search path preserves its behaviour.

alter function public.submit_client_portal_request(text, text, text)
  set search_path = '';

commit;
