import assert from "node:assert/strict";
import test from "node:test";

import {
  validateOutboundAddress,
  validateOutboundAddressSet,
} from "./egress-policy.mjs";

test("accepts representative public IPv4 literals", () => {
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "41.0.0.1",
    "9.9.9.9",
  ]) {
    assert.equal(validateOutboundAddress(address).allowed, true, address);
  }
});

test("rejects non-public and special-purpose IPv4 literals", () => {
  const cases = [
    ["0.1.2.3", "this_network"],
    ["10.20.30.40", "private_use"],
    ["100.64.0.1", "shared_carrier_grade_nat"],
    ["127.0.0.1", "loopback"],
    ["169.254.10.20", "link_local"],
    ["172.16.0.1", "private_use"],
    ["172.31.255.254", "private_use"],
    ["192.0.0.9", "ietf_protocol_assignments"],
    ["192.31.196.25", "special_purpose_anycast"],
    ["192.52.193.1", "special_purpose_amt"],
    ["192.0.2.10", "documentation"],
    ["192.88.99.2", "deprecated_6to4_relay"],
    ["192.168.1.1", "private_use"],
    ["192.175.48.1", "special_purpose_anycast"],
    ["198.18.0.1", "benchmarking"],
    ["198.51.100.7", "documentation"],
    ["203.0.113.7", "documentation"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
  ];

  for (const [address, reason] of cases) {
    const result = validateOutboundAddress(address);
    assert.equal(result.allowed, false, address);
    assert.equal(result.reason, reason, address);
  }
});

test("accepts representative IPv6 global-unicast candidates", () => {
  for (const address of [
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2a00:1450:4001:821::200e",
  ]) {
    assert.equal(validateOutboundAddress(address).allowed, true, address);
  }
});

test("rejects non-global and special-purpose IPv6 literals", () => {
  const cases = [
    ["::", "not_ipv6_global_unicast"],
    ["::1", "not_ipv6_global_unicast"],
    ["::ffff:808:808", "not_ipv6_global_unicast"],
    ["64:ff9b::808:808", "not_ipv6_global_unicast"],
    ["100::1", "not_ipv6_global_unicast"],
    ["100:0:0:1::1", "not_ipv6_global_unicast"],
    ["2001:1::1", "ietf_protocol_assignments"],
    ["2001:10::1", "deprecated_orchid"],
    ["2001:20::1", "orchid_v2"],
    ["2001:30::1", "drone_remote_id_special_purpose"],
    ["2001:2::1", "ietf_protocol_assignments"],
    ["2001:db8::1", "documentation"],
    ["2002::1", "deprecated_6to4"],
    ["2620:4f:8000::1", "special_purpose_anycast"],
    ["3fff::1", "documentation"],
    ["5f00::1", "not_ipv6_global_unicast"],
    ["fc00::1", "not_ipv6_global_unicast"],
    ["fe80::1", "not_ipv6_global_unicast"],
    ["ff02::1", "not_ipv6_global_unicast"],
  ];

  for (const [address, reason] of cases) {
    const result = validateOutboundAddress(address);
    assert.equal(result.allowed, false, address);
    assert.equal(result.reason, reason, address);
  }
});

test("rejects malformed and ambiguous IP literals", () => {
  for (const address of [
    "",
    "localhost",
    "127.1",
    "010.0.0.1",
    "256.1.1.1",
    "1.2.3",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
    "fe80::1%eth0",
    "::ffff:192.0.2.1",
    " 8.8.8.8",
    "8.8.8.8 ",
  ]) {
    const result = validateOutboundAddress(address);
    assert.equal(result.allowed, false, address);
    assert.equal(result.reason, "invalid_ip_literal", address);
  }
});

test("rejects a mixed DNS answer set instead of selecting its public member", () => {
  const result = validateOutboundAddressSet([
    "8.8.8.8",
    "10.0.0.5",
  ]);

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "unsafe_dns_answer");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].allowed, true);
  assert.equal(result.results[1].allowed, false);
});

test("accepts a non-empty DNS answer set only when every address is allowed", () => {
  const result = validateOutboundAddressSet([
    "8.8.8.8",
    "2001:4860:4860::8888",
  ]);

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "all_addresses_allowed");
});

test("rejects an empty or malformed DNS answer set", () => {
  assert.equal(validateOutboundAddressSet([]).reason, "empty_dns_answer_set");
  assert.equal(validateOutboundAddressSet(null).reason, "empty_dns_answer_set");
  assert.equal(
    validateOutboundAddressSet(["8.8.8.8", "not-an-ip"]).allowed,
    false,
  );
});


import { sameOutboundAddress } from "./egress-policy.mjs";

test("compares IPv4 and IPv6 literals by address value, not string spelling", () => {
  assert.equal(sameOutboundAddress("8.8.8.8", "8.8.8.8"), true);
  assert.equal(sameOutboundAddress("8.8.8.8", "8.8.4.4"), false);
  assert.equal(sameOutboundAddress("2001:4860:4860::8888", "2001:4860:4860:0:0:0:0:8888"), true);
  assert.equal(sameOutboundAddress("2001:4860:4860::8888", "2001:4860:4860::8844"), false);
  assert.equal(sameOutboundAddress("2001:4860:4860::8888", "8.8.8.8"), false);
  assert.equal(sameOutboundAddress("not-an-ip", "not-an-ip"), false);
});


test("rejects DNS answer sets above the fixed safety bound", () => {
  const tooMany = Array.from({ length: 65 }, () => "8.8.8.8");
  const result = validateOutboundAddressSet(tooMany);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "dns_answer_limit_exceeded");
  assert.equal(result.results.length, 0);
});
