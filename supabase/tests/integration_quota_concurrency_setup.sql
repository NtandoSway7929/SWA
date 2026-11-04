\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_swayphics_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('test.is_swayphics_admin', true), '')::boolean,
    false
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_swayphics_admin() TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000103'),
  ('00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000105'),
  ('00000000-0000-4000-8000-000000000106');

\ir ../migrations/20261104110000_innerme_integration_quota.sql

COMMIT;
