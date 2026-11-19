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
    deposit_amount numeric(12,2)
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
