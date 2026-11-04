# InnerMe Integration — Stage 10 Outbound IP Policy

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Standalone pure policy module and unit tests. Not yet integrated into the production gateway transport.

## 1. Objective

Define a conservative, deterministic policy for classifying literal IPv4 and IPv6 DNS answers before a future pinned TCP connection. The policy is a local helper: it performs no DNS lookup, opens no sockets, and does not claim that an accepted IP is actually routed or reachable.

The caller must combine all A and AAAA records for the provider lookup and validate the complete set. If the set is empty, malformed, or contains even one rejected address, the complete set is rejected. The caller must not select only the public-looking member of a mixed public/private answer set.

## 2. IANA reference basis

The policy was checked against the official IANA registries as available on 4 November 2026. The current HTML/plain-text registry pages identify their last update as **9 October 2025**.

- [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry)
- [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry)
- [IANA IPv6 Global Unicast Address Space](https://www.iana.org/assignments/ipv6-unicast-address-assignments)

IANA explicitly cautions that a special-purpose registry prefix is not guaranteed to be routable in every local or global context. A `Globally Reachable` field is registry metadata, not proof that a route exists from the Edge Runtime. The policy therefore uses a deliberately conservative deny list and describes passing addresses as candidates only.

## 3. Implementation

Files:

- `supabase/functions/innerme-integration-gateway/egress-policy.mjs`
- `supabase/functions/innerme-integration-gateway/egress-policy.test.mjs`

Exports:

- `validateOutboundAddress(address)`
- `validateOutboundAddressSet(addresses)`

### Parsing guarantees

- IPv4 must be exactly four decimal octets, each in the range 0–255.
- Leading-zero and shortened/ambiguous IPv4 notation is rejected.
- IPv6 is parsed as eight 16-bit groups, including valid `::` compression.
- Scoped addresses, embedded dotted-IPv4 notation and malformed compression are rejected. This is deliberate fail-closed behavior for the current gateway use case.
- Address comparisons use integer/CIDR masks, not string-prefix comparisons.

### IPv4 deny ranges

- `0.0.0.0/8` — this-network
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — private use
- `100.64.0.0/10` — shared carrier-grade NAT
- `127.0.0.0/8` — loopback
- `169.254.0.0/16` — link-local
- `192.0.0.0/24` — conservatively blocks the whole IETF protocol-assignment block, including more-specific exceptions
- `192.2.0.0/24` — reserved for documentation? No. Documentation blocks are separately enumerated below; this line is not used by the implementation.
- `192.31.196.0/24`, `192.52.193.0/24`, `192.175.48.0/24` — special-purpose anycast/AMT ranges, denied even where the registry marks them globally reachable
- `192.2.0.0/24` is not part of the implemented deny policy.
- `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` — documentation
- `192.88.99.0/24` — deprecated 6to4 relay block, conservatively denied as a whole
- `198.18.0.0/15` — benchmarking
- `224.0.0.0/4` — multicast
- `240.0.0.0/4` — reserved, including limited broadcast

### IPv6 deny policy

- Only `2000::/3` is considered for an IPv6 global-unicast candidate.
- IPv4-mapped, unspecified, loopback, discard-only and dummy prefixes are denied.
- The whole `2001::/23` IETF protocol-assignment range is denied, including narrower exceptions that IANA separately marks globally reachable. This avoids a complex special-case allowlist.
- Documentation, benchmarking, 6to4 and SRv6 special-purpose ranges are denied.
- IPv4-IPv6 translation prefixes, unique-local, link-local, multicast and other addresses outside `2000::/3` are rejected by the global-unicast gate.
- The globally reachable AS112 special-purpose prefix `2620:4f:8000::/48` is explicitly denied.

The policy intentionally over-blocks some globally reachable special-purpose anycast/protocol prefixes. That is a deliberate SSRF hardening trade-off for a gateway with a fixed National Treasury destination, not a general-purpose network library.

## 4. CI validation

The new tests are automatically included by the existing command:

```sh
node --test supabase/functions/innerme-integration-gateway/*.test.mjs
```

The suite covers representative IPv4/IPv6 candidates, private/reserved/special-use blocks, malformed literals, IPv4-mapped IPv6, transition/translation ranges, and rejection of a mixed public/private answer set. The gateway Edge Function type-check is also part of the same workflow.

[Gateway CI run](https://github.com/NtandoSway7929/SWA/actions/runs/41814639526)

## 5. Important limitations

- Passing this module means only that the literal address is not in the current code's deny policy. It does not prove global routing, ownership, or reachability.
- This list is a manually maintained snapshot, not generated from IANA registry data. Add a scheduled registry review before production and review changed/new special-purpose allocations.
- The helper is not yet called by the gateway.
- The gateway's DNS lookup, complete A+AAAA collection, literal-IP connect, peer-address check and pinned HTTP transport are not yet implemented.
- It does not protect the production gateway until integrated into the transport path and tested end-to-end.
- A simultaneous DNS rebinding test, IP parser differential testing against another implementation, and full IPv4/IPv6 socket integration test remain outstanding.

## 6. Release status

This stage adds a tested address-classification component only. It does not change the gateway's existing `fetch()` path, any database schema, Supabase project settings, secrets, production code, or deployment. No Treasury endpoint or Supabase project was contacted.

The integration remains not production-ready.
