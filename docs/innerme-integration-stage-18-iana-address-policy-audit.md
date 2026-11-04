# InnerMe Integration — Stage 18 IANA Address-Policy Audit

**Date:** 4 November 2026  
**Branch:** feature/innerme-municipal-money-gateway  
**PR:** #147  
**Status:** Static comparison of the policy snapshot with official IANA registries. Provider-free regression tests passed. This is not a network-routing test or penetration test.

## Official sources

- IANA IPv4 Special-Purpose Address Registry: https://www.iana.org/assignments/iana-ipv4-special-registry — page reports last updated 2025-10-09.
- IANA IPv6 Special-Purpose Address Registry: https://www.iana.org/assignments/iana-ipv6-special-registry — page reports last updated 2025-10-09.
- IANA IPv6 Global Unicast Address Assignments: https://www.iana.org/assignments/ipv6-unicast-address-assignments — page reports last updated 2025-10-10.
- RFC 6890: https://www.rfc-editor.org/rfc/rfc6890/

IANA explicitly warns that special-purpose address prefixes are not guaranteed to be routable in any particular local or global context. The IPv6 assignment registry identifies 2000::/3 as the Global Unicast Address (GUA) block, but also notes that unlisted address space in that block is reserved by IANA for future allocation.

## 1. IPv4 comparison

Every IPv4 special-purpose prefix in the reviewed IANA registry is either explicitly present in the policy deny list or covered by a broader denied prefix.

Examples:
- 0.0.0.0/8, RFC1918 private space, shared carrier-grade NAT, loopback and link-local ranges are denied.
- The full 192.0.0.0/24 IETF protocol-assignment block is denied, including more-specific reservations.
- Documentation, benchmarking, deprecated 6to4 relay, AS112/AMT special-purpose, multicast and reserved ranges are denied.
- The limited-broadcast address 255.255.255.255 is covered by 240.0.0.0/4.

The policy intentionally denies the whole 192.0.0.0/24 parent even though IANA marks 192.0.0.9/32 and 192.0.0.10/32 globally reachable. This also blocks the more-specific NAT64/DNS64 discovery addresses 192.0.0.170/32 and 192.0.0.171/32.

## 2. IPv6 comparison

The policy accepts only addresses inside the 2000::/3 GUA range, then applies its deny list.

IANA special-purpose prefixes outside 2000::/3 are therefore rejected by the positive range test, including:
- IPv4-translatable prefixes 64:ff9b::/96 and 64:ff9b:1::/48;
- discard-only 100::/64 and dummy prefix 100:0:0:1::/64;
- IPv4-mapped, unspecified and loopback addresses;
- unique-local fc00::/7 and link-local fe80::/10.

Inside 2000::/3, the policy denies:
- the whole 2001::/23 IETF protocol-assignment parent;
- 2001:10::/28, 2001:20::/28 and 2001:30::/28 explicitly;
- 2001:2::/48 benchmarking;
- 2001:db8::/32 documentation;
- 2002::/16 deprecated 6to4;
- 2620:4f:8000::/48 AS112 and 3fff::/20 documentation.

The whole 2001::/23 parent is denied even though IANA registers more-specific globally reachable anycast allocations within it. This is deliberate conservative behavior. Regression cases now explicitly test 2001:1::1, 2001:1::2, 2001:1::3, 2001:3::1 and 2001:4:112::1 as denied, in addition to the parent and other IANA entries.

The 2000::/3 test is a broad candidate-range check, not a proof that an address inside it is allocated to an RIR or currently globally routed. IANA identifies unlisted portions of the GUA block as reserved for future allocation. The current code therefore means “within the broad GUA candidate range and not in the deny list”, not “confirmed globally routable”. A stricter registry-driven positive allowlist would need its own design and refresh process before claiming affirmative routability.

## 3. CI regression result

[PASS] [GitHub Actions run #41821649273](https://github.com/NtandoSway7929/SWA/actions/runs/41821649273).

- 60/60 provider-free tests passed.
- Deno Edge Function type-check passed.
- `git diff --check` passed.
- Tests include IPv4/IPv6 special-purpose blocks, mixed safe/unsafe DNS answers, empty/malformed DNS results, 64-answer cap, numeric peer comparison, and explicit globally reachable anycast exceptions covered by the broad deny policy.

The source lists and code are manually maintained snapshots. They are not automatically synchronized with IANA. Recheck the registries before release and on a defined maintenance cadence.

## 4. Remaining limitations

- Registry classification does not guarantee reachability, allocation status for every address, or route behavior in the deployed environment.
- IPv6 literal parsing and policy are unit-tested, but the full local Edge Runtime adapter mock currently exercises IPv4 socket connectivity only.
- A locally allowed mock override exists only in CI; production does not use it and applies the normal address policy.
- The address policy does not resolve the separate managed Supabase runtime/permission question.

The address policy is a conservative destination filter, not a standalone proof of complete SSRF immunity. The integration remains not production-ready.
