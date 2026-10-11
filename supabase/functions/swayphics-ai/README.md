# swayphics-ai Edge Function

This directory contains the `swayphics-ai` Edge Function source retrieved from the active Swayphics production Supabase deployment, version 90, on 2026-10-11, plus repository-only static type-check corrections made after that retrieval.

**Important:** production has not been redeployed from this repository-only revision. The checked-in `index.ts` therefore is not byte-for-byte identical to the currently active production entry point. The helper module `innerme-evidence-traceability.mjs` matches the helper retrieved from production.

## Source provenance

- Entry point: `index.ts`
- Local module dependency: `innerme-evidence-traceability.mjs`
- Production function slug: `swayphics-ai`
- Production project ref: `sqifhribgsqfaxgtobsa`
- Deployment bundle SHA-256 reported by Supabase for the retrieved production v90 bundle: `852e470ccec1e2b1eb47eac05f268f40124b5b269c6ff097c8a4664965bcc2cd`

The bundle hash identifies the retrieved deployment bundle before the repository-only type-check corrections. It is not asserted to be a hash of either source file individually.

## Validation

The repository workflow `.github/workflows/validate-innerme-function.yml` runs `deno check --no-lock` on the entry point. A successful static type check does not establish live runtime behaviour or prove that deployment is safe.

## Deployment cautions

- This source change and its static corrections have not been deployed to production.
- Review the full diff and run a controlled runtime smoke test before deploying.
- The deployed gateway currently uses `verify_jwt=false`; the handler validates the bearer token and Swayphics-admin authorization internally. Preserve this configuration unless the authentication architecture is deliberately changed and tested.
- Keep credentials in Supabase Edge Function secrets, never in source files or commits.
- Do not introduce automatic production deployment until environment protection and human approval gates have been reviewed.
