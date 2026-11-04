# InnerMe Integration — Stage 19 Dual-Stack Edge Runtime Verification

**Date:** 4 November 2026  
**Branch:** feature/innerme-municipal-money-gateway  
**PR:** #147  
**Status:** Full adapter flow passed over IPv4 and IPv6 literal-IP TCP/TLS in the pinned local Supabase Edge Runtime. No Treasury or Supabase project endpoint was contacted.

## Objective

Close the earlier gap where IPv6 policy/parser/peer-comparison tests existed, but the full Edge Runtime mock exercised IPv4 sockets only.

## CI topology

- GitHub Actions runner with a Docker dual-stack network.
- Docker network IPv4 subnet plus ULA IPv6 subnet `fd00:dead:beef::/64`.
- Local dual-stack TLS mock server on port 443.
- Pinned `supabase/edge-runtime:v1.77.9`.
- Actual Municipal Money adapter, pinned HTTP module and address policy staged read-only.
- Short-lived test CA and certificate valid for `municipaldata.treasury.gov.za`.

The test-only DNS resolver maps the fixed Treasury hostname to the local mock service alias. The ordinary adapter pass resolves both A and AAAA and uses the IPv4 result first. A second full adapter pass deliberately returns no A records and resolves only the AAAA record, forcing the production transport code path to connect to a literal IPv6 address.

The CI-only address policy allows exactly the mock's resolved address for the corresponding pass. The real production address policy is not changed and rejects ULA/private addresses.

## Result

[PASS] [GitHub Actions run #41822450213](https://github.com/NtandoSway7929/SWA/actions/runs/41822450213).

IPv4 pass:
- 3 catalogue validations and 1 facts request.
- Four A lookups and four AAAA lookups.
- Four literal-IP TCP connections and four TLS sessions.
- Connected address: `172.18.0.2`.
- The mock observed SNI and HTTP Host `municipaldata.treasury.gov.za`.

IPv6-only pass:
- 3 catalogue validations and 1 facts request.
- Four A lookups returning an empty list and four AAAA lookups.
- Four literal-IP IPv6 TCP connections and four TLS sessions.
- Connected address: `fd00:dead:beef::2`.
- The mock observed SNI and HTTP Host `municipaldata.treasury.gov.za`.

Both adapter passes returned `status: ok`, one normalized facts record, amount 1250, and preserved the source amount. All CI assertions passed and Docker resources were removed.

## What this proves

1. The actual pinned transport can pass its IPv6 literal to `Deno.connect` in the tested local Edge Runtime.
2. The same socket's peer address is successfully checked against the selected literal IPv6 DNS result.
3. TLS starts over that IPv6 connection while verifying the fixed Treasury hostname.
4. The mock observes the expected Treasury SNI and HTTP Host over IPv6.
5. The full adapter performs all three catalogue preflights and the facts request over the IPv6-only path.
6. The no-A/valid-AAAA family handling works when the A query returns no records.

## What this does not prove

- The IPv6 address is a ULA Docker test address accepted only by a CI-injected address policy. It is not a public IPv6 address and is rejected by the production policy.
- No live Treasury IPv6 route, public destination, DNS result, certificate, API response or provider allowance was tested.
- This is not a managed Supabase project test. Hosted Edge Function permissions, runtime build, JWT/RPC behavior and deployment configuration remain unverified.
- It does not establish routability or correct assignment of arbitrary IPv6 destinations; the IANA Stage 18 limitations still apply.

## Release decision

The local IPv6 socket-path proof is now complete for the pinned Edge Runtime image. The remaining platform gate is managed Supabase verification in an explicitly approved isolated project. The integration remains not production-ready pending that gate, live provider verification, publication-date compliance, owner approval for quota ceilings and separate approval for deployment/chat integration.
