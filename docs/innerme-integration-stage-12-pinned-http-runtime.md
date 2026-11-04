# InnerMe Integration — Stage 12 Pinned HTTP Runtime Verification

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Actual transport module executed successfully in the pinned local Supabase Edge Runtime container. No Treasury or Supabase project request was made.

## Objective and CI topology

The workflow exercises the actual `pinned-http.mjs` module in `supabase/edge-runtime:v1.77.9`, using a local Node.js TLS mock server in a private Docker network and a short-lived test CA/certificate for `municipaldata.treasury.gov.za`.

A read-only runtime bundle contains the actual `pinned-http.mjs` and `egress-policy.mjs`. A user worker imports and calls `requestPinnedMunicipalMoney()`.

The test DNS wrapper confirms that the transport asks for the fixed Treasury hostname and requests both A and AAAA. It maps the fixture lookup to the local mock server. A test-only address-policy override permits exactly the private Docker IP resolved for that mock; it is hard-coded to the local fixture and cannot be supplied through the request body. Production retains the actual deny policy and rejects private destinations.

## Result

[PASS] [GitHub Actions run #41817303856](https://github.com/NtandoSway7929/SWA/actions/runs/41817303856).

Observed response:

```json
{
  "status": 200,
  "connectedAddress": "172.18.0.2",
  "connectedToLiteralIp": true,
  "peerAddressMatched": true,
  "tlsHostname": "municipaldata.treasury.gov.za",
  "tlsSniObservedByServer": "municipaldata.treasury.gov.za",
  "httpHostObservedByServer": "municipaldata.treasury.gov.za",
  "method": "GET",
  "pathRestrictedToFactsEndpoint": true,
  "identityEncodingRequested": true,
  "boundedHttpResponseParsed": true,
  "redirectFollowed": false,
  "testOnlyPrivateDestination": true
}
```

All workflow assertions passed and the temporary Docker resources were removed.

## What this proves

1. The actual transport module loads and runs in the selected Supabase Edge Runtime image.
2. It asks for both A and AAAA records for the fixed provider hostname.
3. It connects to a literal IP rather than passing the provider hostname to the TCP connector.
4. The socket peer matches the selected address.
5. TLS uses the original Treasury hostname and the local server observes the expected SNI.
6. The HTTP Host header is the fixed Treasury hostname.
7. The request is GET-only and targets the approved facts route.
8. Identity encoding is requested.
9. The bounded HTTP response parser reads the mock JSON response.
10. The transport does not follow redirects.

## What this does not prove

- The private Docker IP was permitted only by the CI test override; production policy rejects private addresses.
- No Treasury DNS, network route, live certificate chain, API response, catalogue metadata or provider rate allowance was tested.
- This is not a managed Supabase project test; it does not verify hosted project permissions, runtime build, Auth/JWT, PostgREST or deployment settings.
- The test sends the facts route only. Member routes are allowlisted but were not separately sent through the mock in this workflow.
- It does not exercise IPv6 socket connectivity, live DNS rebinding, TLS timeout against a stalled peer or every HTTP/1.1 edge case.
- The existing Municipal Money adapter has not yet switched from Fetch to the pinned transport.

## Runtime compatibility

Deno's current API reference marks `Deno.connect` unstable and requires `allow-net`. It documents literal-IP input (including bracketed IPv6 notation), abort signals for DNS and TCP connection establishment, and `Deno.startTls` with hostname verification enabled by default. The test confirms the required subset in the pinned local image, not a contractual guarantee for every managed Supabase deployment.

References:
- [Deno Network API](https://docs.deno.com/api/deno/network/)
- [Supabase Edge Runtime repository](https://github.com/supabase/edge-runtime)

## Decision

The feasibility of a pinned HTTP/1.1 request in the tested local Edge Runtime is demonstrated. No paid proxy is needed for the next development step.

Next: integrate this transport into the isolated Municipal Money adapter for both member-catalogue and facts requests. Keep Fetch as an explicit provider-free test seam only; it must not remain the production default. Test both route types with the Edge Runtime mock and keep all live projects unchanged.

The integration remains not production-ready pending adapter wiring, complete security review, managed Supabase validation, Treasury publication-date compliance and approval for any hosted migration or deployment.
