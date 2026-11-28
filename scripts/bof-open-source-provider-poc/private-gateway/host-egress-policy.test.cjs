"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validatePolicy } = require("./validate-host-egress-policy.cjs");

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "host-egress-policy.json"), "utf8"));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function expectRejected(label, mutate) {
    const candidate = clone(baseline);
    mutate(candidate);
    let rejected = false;
    try { validatePolicy(candidate); } catch { rejected = true; }
    assert(rejected, "Unsafe mutation was accepted: " + label);
    console.log("PASS rejects " + label);
}

validatePolicy(baseline);
console.log("PASS accepts the reviewed design-only baseline");
expectRejected("a policy marked as applied", (p) => { p.scope.host_firewall_rules_applied = true; });
expectRejected("a permissive default outbound action", (p) => { p.default_policy.new_outbound_connections = "allow"; });
expectRejected("an allow rule ordered before destination denials", (p) => { p.evaluation.new_egress_order.reverse(); });
expectRejected("optional cloudflared TCP 443", (p) => {
    p.source_networks.find((x) => x.service === "cloudflared").new_outbound_allow.ports.push(443);
});
expectRejected("a missing IPv4 link-local and metadata block", (p) => {
    p.destination_denials.ipv4_baseline = p.destination_denials.ipv4_baseline.filter((x) => x !== "169.254.0.0/16");
});
expectRejected("a missing IPv6 unique-local block", (p) => {
    p.destination_denials.ipv6_baseline = p.destination_denials.ipv6_baseline.filter((x) => x !== "fc00::/7");
});
expectRejected("a guessed host-specific subnet", (p) => {
    p.destination_denials.host_specific_ranges.push("192.168.50.0/24");
});
expectRejected("arbitrary direct container DNS", (p) => { p.dns.arbitrary_dns_egress = "allow"; });
expectRejected("missing cloudflared endpoint refresh gate", (p) => {
    p.source_networks.find((x) => x.service === "cloudflared").new_outbound_allow.refresh_before_deployment = false;
});
expectRejected("missing IPv6 path review", (p) => { p.ipv6.forwarding_audit_required = false; });
expectRejected("missing the host firewall rollback preflight", (p) => { p.host_preflight_required = []; });
console.log("BOF host egress manifest regression tests passed.");
