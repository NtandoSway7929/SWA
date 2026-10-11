# swayphics-ai Edge Function

This directory mirrors the source files retrieved from the active Swayphics production Supabase Edge Function deployment, version 90, on 2026-10-11.

## Source provenance

- Entry point: `index.ts`
- Local module dependency: `innerme-evidence-traceability.mjs`
- Production function slug: `swayphics-ai`
- Production project ref: `sqifhribgsqfaxgtobsa`
- Deployment bundle SHA-256 reported by Supabase: `852e470ccec1e2b1eb47eac05f268f40124b5b269c6ff097c8a4664965bcc2cd`

The bundle hash above is the SHA-256 reported for the deployed bundle. It is not claimed to be a hash of either source file individually.

## Deployment cautions

- This change synchronizes source; it does not deploy a new function version.
- Review the full diff and run appropriate syntax/static checks before deployment.
- The deployed gateway currently uses `verify_jwt=false`; the handler performs bearer-token validation and Swayphics-admin authorization internally. Preserve this configuration unless the authentication architecture is deliberately changed and tested.
- Keep all credentials in Supabase Edge Function secrets, never in these files or commits.
- Do not introduce automatic production deployment until environment protection and human approval gates have been reviewed.
