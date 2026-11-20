# swayphics-ai Edge Function

This directory contains the checked-in source and tests for the production InnerMe Edge Function.

## Production source provenance

On 20 November 2026, the production function was retrieved from Supabase at version **149** before this credential-rotation patch. Its deployed `index.ts` contained 71 lines of production changes not yet present on GitHub `main`; those changes were preserved when synchronising the production source into this branch. All ten deployed helper modules were byte-for-byte identical to the checked-in files.

The production gateway remains configured with `verify_jwt=false`. The function performs its own bearer-token validation and Swayphics-admin authorization checks. Preserve this setting unless the authentication design is intentionally changed and tested.

## Credential handling

Server-side telemetry and quota operations use the Supabase-injected `SUPABASE_SERVICE_ROLE_KEY`. The function must not read a custom `SUPABASE_SECRET_KEY` value or silently switch between credentials.

Keep credentials in the Supabase runtime environment. Never commit API keys or JWT values.

## Validation

The `validate-innerme-function.yml` workflow type-checks the function, runs the isolated authentication and provider-routing tests, and performs non-mutating health and authentication-boundary checks. Do not treat a health GET or an unauthenticated 401 as proof that a real authenticated business action completed.
