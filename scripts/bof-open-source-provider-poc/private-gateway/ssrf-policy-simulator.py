#!/usr/bin/env python3
"""Offline SSRF policy decision simulator for the BOF POC.

This checks DNS answer sets and redirect hops against the declarative manifest.
It does not open sockets, change DNS, install firewall rules, or prove host enforcement.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
from pathlib import Path
from urllib.parse import urlsplit

MANIFEST = Path(__file__).with_name("host-egress-policy.json")


def load_policy():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def network_list(policy, family):
    section = policy["destination_denials"]
    values = section["ipv4_baseline" if family == 4 else "ipv6_baseline"]
    return [ipaddress.ip_network(value) for value in values]


def classify_address(value, policy):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return "invalid_ip"

    # Reject mapped IPv4 and translation prefixes rather than relying on
    # resolver/client-specific address-family handling.
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return "ipv4_mapped_ipv6"
        for cidr in policy["destination_denials"]["ipv6_baseline"]:
            network = ipaddress.ip_network(cidr)
            if address in network:
                return "blocked_ipv6_range:" + cidr

    ranges = network_list(policy, address.version)
    for network in ranges:
        if address in network:
            return "blocked_ipv" + str(address.version) + "_range:" + str(network)

    if not address.is_global:
        return "not_global_unicast"
    return "public_global_unicast"


def evaluate_url(url, resolved_addresses, allowed_ports, policy):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False, "unsupported_url"
        if parsed.username is not None or parsed.password is not None:
            return False, "url_credentials"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return False, "invalid_url"

    if port not in allowed_ports:
        return False, "port_not_allowed"
    if not resolved_addresses:
        return False, "dns_no_answers"

    # Fail closed on mixed A/AAAA answers. A client must not be allowed to
    # choose the public answer while another answer targets a protected range.
    classifications = [classify_address(item, policy) for item in resolved_addresses]
    if any(item != "public_global_unicast" for item in classifications):
        return False, "dns_answer_set_not_entirely_public:" + ",".join(classifications)
    return True, "allowed"


def evaluate_redirect_chain(initial_url, hops, allowed_ports, policy):
    """Each hop is {url, resolved_addresses}; re-evaluate DNS at every hop."""
    chain = [{"url": initial_url, "resolved_addresses": hops[0]["resolved_addresses"]}] + hops[1:]
    for index, hop in enumerate(chain):
        allowed, reason = evaluate_url(
            hop["url"], hop.get("resolved_addresses", []), allowed_ports, policy
        )
        if not allowed:
            return False, index, reason
    return True, None, "all_hops_allowed"


def run_self_tests(policy):
    import unittest

    class PolicySimulatorTests(unittest.TestCase):
        def test_public_ipv4_allowed(self):
            self.assertEqual(classify_address("1.1.1.1", policy), "public_global_unicast")

        def test_public_ipv6_allowed(self):
            self.assertEqual(classify_address("2606:4700:4700::1111", policy), "public_global_unicast")

        def test_loopback_private_link_local_and_metadata_blocked(self):
            for address in ("127.0.0.1", "10.1.2.3", "172.16.0.1",
                            "192.168.1.1", "169.254.169.254", "100.64.0.1"):
                with self.subTest(address=address):
                    self.assertNotEqual(classify_address(address, policy), "public_global_unicast")

        def test_ipv6_loopback_ula_link_local_and_metadata_blocked(self):
            for address in ("::1", "fc00::1", "fe80::1", "fd00:ec2::254"):
                with self.subTest(address=address):
                    self.assertNotEqual(classify_address(address, policy), "public_global_unicast")

        def test_ipv4_mapped_ipv6_blocked(self):
            self.assertEqual(classify_address("::ffff:127.0.0.1", policy), "ipv4_mapped_ipv6")

        def test_nat64_translation_prefix_blocked(self):
            self.assertNotEqual(classify_address("64:ff9b::7f00:1", policy), "public_global_unicast")

        def test_mixed_public_and_private_dns_answers_fail_closed(self):
            allowed, reason = evaluate_url(
                "https://rebinding.test/", ["1.1.1.1", "10.0.0.8"], {443}, policy
            )
            self.assertFalse(allowed)
            self.assertIn("dns_answer_set_not_entirely_public", reason)

        def test_dns_rebinding_on_later_resolution_fails_closed(self):
            hops = [
                {"url": "https://rebinding.test/", "resolved_addresses": ["1.1.1.1"]},
                {"url": "https://rebinding.test/next", "resolved_addresses": ["169.254.169.254"]},
            ]
            allowed, blocked_index, reason = evaluate_redirect_chain(
                hops[0]["url"], hops, {80, 443}, policy
            )
            self.assertFalse(allowed)
            self.assertEqual(blocked_index, 1)
            self.assertIn("dns_answer_set_not_entirely_public", reason)

        def test_redirect_to_loopback_is_blocked(self):
            hops = [
                {"url": "https://public.test/", "resolved_addresses": ["1.1.1.1"]},
                {"url": "http://127.0.0.1/admin", "resolved_addresses": ["127.0.0.1"]},
            ]
            allowed, blocked_index, _ = evaluate_redirect_chain(
                hops[0]["url"], hops, {80, 443}, policy
            )
            self.assertFalse(allowed)
            self.assertEqual(blocked_index, 1)

        def test_unapproved_port_is_blocked(self):
            allowed, reason = evaluate_url("https://public.test:8443/", ["1.1.1.1"], {80, 443}, policy)
            self.assertFalse(allowed)
            self.assertEqual(reason, "port_not_allowed")

        def test_credentials_and_unsupported_scheme_blocked(self):
            for url in ("https://user:pass@public.test/", "file:///etc/passwd", "ftp://public.test/"):
                with self.subTest(url=url):
                    allowed, _ = evaluate_url(url, ["1.1.1.1"], {80, 443}, policy)
                    self.assertFalse(allowed)

        def test_empty_dns_answer_fails_closed(self):
            allowed, reason = evaluate_url("https://public.test/", [], {443}, policy)
            self.assertFalse(allowed)
            self.assertEqual(reason, "dns_no_answers")

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PolicySimulatorTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return result.wasSuccessful()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="run offline policy decision regression tests")
    args = parser.parse_args()
    policy = load_policy()
    if args.self_test:
        raise SystemExit(0 if run_self_tests(policy) else 1)
    print("Policy loaded. Use --self-test to run offline DNS/redirect decision cases.")
    print("No network requests or firewall changes are performed.")
    

if __name__ == "__main__":
    main()
