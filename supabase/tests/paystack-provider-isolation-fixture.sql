-- Minimal disposable PostgreSQL fixture for the Paystack provider-isolation test.
-- This is intentionally not a production schema baseline.
CREATE SCHEMA IF NOT EXISTS innerme_private;

CREATE TABLE public.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    currency text NOT NULL DEFAULT 'ZAR',
    total numeric(12,2) NOT NULL DEFAULT 0,
    amount_outstanding numeric(12,2) NOT NULL DEFAULT 0,
    online_payment_enabled boolean NOT NULL DEFAULT false,
    online_payment_provider text DEFAULT 'paystack',
    partial_payment_enabled boolean NOT NULL DEFAULT false,
    deposit_amount numeric(12,2),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS auth;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END;
$roles$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$;

CREATE OR REPLACE FUNCTION public.is_swayphics_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $
    SELECT auth.uid() IS NOT NULL
$;

CREATE OR REPLACE FUNCTION public.admin_set_invoice_payment_settings(
    p_invoice_id uuid,
    p_online_payment_enabled boolean,
    p_partial_payment_enabled boolean,
    p_deposit_amount numeric DEFAULT NULL,
    p_provider text DEFAULT 'paystack'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
    RETURN '{}'::jsonb;
END;
$;

INSERT INTO public.invoices (
    id, client_id, status, currency, total, amount_outstanding,
    online_payment_enabled, online_payment_provider
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'sent', 'ZAR', 700, 700, false, 'yoco'
);

CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL,
    status text NOT NULL
);

CREATE TABLE public.payment_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL,
    client_id uuid NOT NULL,
    provider text NOT NULL,
    environment text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    provider_checkout_id text,
    checkout_url text,
    UNIQUE (provider, environment, client_id, idempotency_key)
);
