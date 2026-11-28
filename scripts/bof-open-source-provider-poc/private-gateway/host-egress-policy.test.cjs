"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validatePolicy, validateComposeConfig } = require("./validate-host-egress-policy.cjs");

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
function composeFixture(policy) {
    const topology = policy.topology;
    const services = {};
    for (const [name, networks] of Object.entries(topology.services)) {
        services[name] = { networks: Object.fromEntries(networks.map(n => [n, {}])) };
    }
    for (const [name, address] of Object.entries(topology.gateway_fixed_addresses)) {
        services.gateway.networks[name].ipv4_address = address;
    }
    services.cloudflared.profiles = [topology.cloudflared_profile];
    return {
        services,
        networks: Object.fromEntries(topology.networks.map(n => [n.name, {
            ...(n.internal ? { internal: true } : {}),
            ipam: { config: [{ subnet: n.subnet }] },
            ...(!n.internal ? { driver: "bridge" } : {})
        }]))
    };
}
function expectComposeRejected(label, mutate) {
    const candidate = composeFixture(baseline);
    mutate(candidate);
    let rejected = false;
    try { validateComposeConfig(candidate, baseline); } catch { rejected = true; }
    assert(rejected, "Unsafe Compose change was accepted: " + label);
    console.log("PASS rejects Compose drift: " + label);
}

validatePolicy(baseline);
console.log("PASS accepts the reviewed design-only baseline");

expectRejected("a policy marked as applied", p => { p.scope.host_firewall_rules_applied = true; });
expectRejected("a permissive default outbound action", p => { p.default_policy.new_outbound_connections = "allow"; });
expectRejected("an allow rule ordered before destination denials", p => { p.evaluation.new_egress_order.reverse(); });
expectRejected("optional cloudflared TCP 443", p => {
    p.source_networks.find(x => x.service === "cloudflared").new_outbound_allow.ports.push(443);
});
expectRejected("a missing IPv4 link-local and metadata block", p => {
    p.destination_denials.ipv4_baseline = p.destination_denials.ipv4_baseline.filter(x => x !== "169.254.0.0/16");
});
expectRejected("a missing IPv6 unique-local block", p => {
    p.destination_denials.ipv6_baseline = p.destination_denials.ipv6_baseline.filter(x => x !== "fc00::/7");
});
expectRejected("a guessed host-specific subnet", p => { p.destination_denials.host_specific_ranges.push("192.168.50.0/24"); });
expectRejected("arbitrary direct container DNS", p => { p.dns.arbitrary_dns_egress = "allow"; });
expectRejected("missing cloudflared endpoint refresh gate", p => {
    p.source_networks.find(x => x.service === "cloudflared").new_outbound_allow.refresh_before_deployment = false;
});
expectRejected("missing IPv6 path review", p => { p.ipv6.forwarding_audit_required = false; });
expectRejected("missing the host firewall rollback preflight", p => { p.host_preflight_required = []; });

const goodCompose = composeFixture(baseline);
assert(validateComposeConfig(goodCompose, baseline), "Canonical Compose fixture should pass.");
console.log("PASS accepts the expected Compose service and network topology");

expectComposeRejected("SearXNG egress subnet changes", c => {
    c.networks.search_egress.ipam.config[0].subnet = "10.77.41.0/24";
});
expectComposeRejected("the tunnel network is not marked internal", c => {
    c.networks.tunnel_internal.internal = false;
});
expectComposeRejected("Valkey is attached to a public egress bridge", c => {
    c.services.valkey.networks.search_egress = {};
});
expectComposeRejected("Caddy is attached to an egress network", c => {
    c.services.gateway.networks.crawl_egress = {};
});
expectComposeRejected("the crawler loses its dedicated egress network", c => {
    delete c.services.crawl4ai.networks.crawl_egress;
});
expectComposeRejected("a host port is published", c => {
    c.services.gateway.ports = [{ target: 8080, published: "8080", protocol: "tcp" }];
});
expectComposeRejected("the cloudflared tunnel profile is made unconditional", c => {
    c.services.cloudflared.profiles = [];
});
expectComposeRejected("the gateway fixed limiter address drifts", c => {
    c.services.gateway.networks.search_internal.ipv4_address = "10.77.10.253";
});
expectComposeRejected("an unexpected network is added", c => {
    c.networks.unreviewed_external = { ipam: { config: [{ subnet: "10.99.0.0/24" }] } };
});

console.log("BOF host egress policy and Compose topology regression tests passed.");
