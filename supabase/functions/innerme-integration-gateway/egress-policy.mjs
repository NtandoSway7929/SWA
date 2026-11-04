/**
 * Conservative outbound IP policy for the InnerMe external integration gateway.
 *
 * This module classifies literal IP addresses only. It does not resolve DNS,
 * connect sockets, or provide a guarantee that an accepted address is routed
 * globally. Callers must validate every A and AAAA answer before connecting.
 */

function parseIPv4(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8n) | BigInt(octet);
  }

  return result;
}

function parseIPv6(value) {
  if (typeof value !== "string" || value.includes("%") || value.includes(".")) {
    return null;
  }

  const parts = value.toLowerCase().split("::");
  if (parts.length > 2) return null;

  const parseSide = (side) => {
    if (side === "") return [];
    const groups = side.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
      return null;
    }
    return groups.map((group) => Number.parseInt(group, 16));
  };

  const left = parseSide(parts[0]);
  const right = parts.length === 2 ? parseSide(parts[1]) : [];
  if (left === null || right === null) return null;

  let groups;
  if (parts.length === 2) {
    const zeroCount = 8 - left.length - right.length;
    if (zeroCount < 1) return null;
    groups = [...left, ...Array(zeroCount).fill(0), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  if (groups.length !== 8) return null;

  return groups.reduce(
    (result, group) => (result << 16n) | BigInt(group),
    0n,
  );
}

function parseAddress(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.includes(":")) {
    const value128 = parseIPv6(value);
    return value128 === null ? null : { family: 6, value: value128, width: 128 };
  }

  const value32 = parseIPv4(value);
  return value32 === null ? null : { family: 4, value: value32, width: 32 };
}

function parseCidr(cidr) {
  const [address, prefixText, ...extra] = cidr.split("/");
  if (!address || prefixText === undefined || extra.length > 0) {
    throw new Error("Invalid policy CIDR: " + cidr);
  }

  const parsed = parseAddress(address);
  const prefix = Number(prefixText);
  if (
    parsed === null ||
    !/^(0|[1-9][0-9]{0,2})$/.test(prefixText) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > parsed.width
  ) {
    throw new Error("Invalid policy CIDR: " + cidr);
  }

  const mask = prefix === 0
    ? 0n
    : ((1n << BigInt(prefix)) - 1n) << BigInt(parsed.width - prefix);

  return Object.freeze({
    family: parsed.family,
    base: parsed.value & mask,
    mask,
    cidr,
  });
}

function matches(address, network) {
  return address.family === network.family &&
    (address.value & network.mask) === network.base;
}

const IPV4_DENY = Object.freeze([
  ["0.0.0.0/8", "this_network"],
  ["10.0.0.0/8", "private_use"],
  ["100.64.0.0/10", "shared_carrier_grade_nat"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link_local"],
  ["172.16.0.0/12", "private_use"],
  // Conservative: block the whole IETF protocol-assignment /24, including
  // narrower globally-reachable exceptions, to avoid special-case routing.
  ["192.0.0.0/24", "ietf_protocol_assignments"],
  ["192.0.2.0/24", "documentation"],
  ["192.88.99.0/24", "deprecated_6to4_relay"],
  ["192.168.0.0/16", "private_use"],
  ["198.18.0.0/15", "benchmarking"],
  ["198.51.100.0/24", "documentation"],
  ["203.0.113.0/24", "documentation"],
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"],
].map(([cidr, reason]) => Object.freeze({ ...parseCidr(cidr), reason })));

const IPV6_GLOBAL_UNICAST = parseCidr("2000::/3");

const IPV6_DENY = Object.freeze([
  ["::/128", "unspecified"],
  ["::1/128", "loopback"],
  ["::ffff:0:0/96", "ipv4_mapped"],
  ["100::/64", "discard_only"],
  ["100:0:0:1::/64", "dummy_prefix"],
  // Conservative: deny the broad IETF special-purpose assignment block.
  ["2001::/23", "ietf_protocol_assignments"],
  ["2001:2::/48", "benchmarking"],
  ["2001:db8::/32", "documentation"],
  ["2002::/16", "deprecated_6to4"],
  ["3fff::/20", "documentation"],
  ["5f00::/16", "segment_routing_special_purpose"],
].map(([cidr, reason]) => Object.freeze({ ...parseCidr(cidr), reason })));

export function validateOutboundAddress(address) {
  const parsed = parseAddress(address);
  if (parsed === null) {
    return Object.freeze({
      allowed: false,
      family: null,
      reason: "invalid_ip_literal",
    });
  }

  if (parsed.family === 4) {
    const blocked = IPV4_DENY.find((network) => matches(parsed, network));
    if (blocked) {
      return Object.freeze({
        allowed: false,
        family: 4,
        reason: blocked.reason,
        matchedCidr: blocked.cidr,
      });
    }

    return Object.freeze({
      allowed: true,
      family: 4,
      reason: "public_ipv4_candidate",
    });
  }

  if (!matches(parsed, IPV6_GLOBAL_UNICAST)) {
    return Object.freeze({
      allowed: false,
      family: 6,
      reason: "not_ipv6_global_unicast",
    });
  }

  const blocked = IPV6_DENY.find((network) => matches(parsed, network));
  if (blocked) {
    return Object.freeze({
      allowed: false,
      family: 6,
      reason: blocked.reason,
      matchedCidr: blocked.cidr,
    });
  }

  return Object.freeze({
    allowed: true,
    family: 6,
    reason: "public_ipv6_candidate",
  });
}

/**
 * Reject the entire DNS answer set if it is empty or any answer is unsafe.
 * The caller must combine all A and AAAA results before calling this helper.
 */
export function validateOutboundAddressSet(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return Object.freeze({
      allowed: false,
      reason: "empty_dns_answer_set",
      results: Object.freeze([]),
    });
  }

  const results = addresses.map((address) => ({
    address,
    ...validateOutboundAddress(address),
  }));
  const blocked = results.find((result) => !result.allowed);

  return Object.freeze({
    allowed: blocked === undefined,
    reason: blocked === undefined ? "all_addresses_allowed" : "unsafe_dns_answer",
    results: Object.freeze(results.map((result) => Object.freeze(result))),
  });
}
