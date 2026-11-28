"use strict";

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_SOURCES = [
    { service: "searxng", source_cidr: "10.77.40.0/24", protocols: ["tcp"], ports: [443] },
    { service: "crawl4ai", source_cidr: "10.77.50.0/24", protocols: ["tcp"], ports: [80, 443] },
    { service: "cloudflared", source_cidr: "10.77.60.0/24", protocols: ["tcp", "udp"], ports: [7844] }
];
const REQUIRED_IPV4_BASELINE = [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
    "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
    "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
    "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32"
];
const REQUIRED_IPV6_BASELINE = [
    "::/128", "::1/128", "::ffff:0:0/96", "64:ff9b::/96",
    "64:ff9b:1::/48", "100::/64", "2001:db8::/32",
    "fc00::/7", "fe80::/10", "ff00::/8"
];
const EXPECTED_CLOUDFLARE_HOSTS = ["region1.v2.argotunnel.com", "region2.v2.argotunnel.com"];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function sameArray(actual, expected) {
    return Array.isArray(actual) &&
        JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}
function validateCidr(value, family, label) {
    assert(typeof value === "string" && value.includes("/"), label + " must be a CIDR string.");
    const parts = value.split("/");
    assert(parts.length === 2, label + " has an invalid CIDR shape: " + value);
    const version = net.isIP(parts[0]);
    const prefix = Number(parts[1]);
    const maxPrefix = family === 4 ? 32 : 128;
    assert(version === family, label + " has the wrong address family: " + value);
    assert(Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix,
        label + " has an invalid prefix length: " + value);
}
function validateIp(value, family, label) {
    assert(typeof value === "string" && net.isIP(value) === family,
        label + " is not a valid IPv" + family + " address: " + value);
}

function validatePolicy(policy) {
    assert(policy && typeof policy === "object" && !Array.isArray(policy), "Policy must be a JSON object.");
    assert(policy.policy_id === "bof-private-provider-host-egress-v1", "Unexpected policy_id.");
    assert(policy.schema_version === 1, "Unsupported schema_version.");
    assert(policy.lifecycle === "design-only-not-host-validated", "Policy must remain explicitly design-only.");
    assert(policy.scope?.host_firewall_rules_applied === false, "Manifest must not claim host firewall rules were applied.");
    assert(policy.scope?.host_firewall_commands_generated === false, "Manifest must not generate host firewall commands.");
    assert(policy.scope?.forwarding_sysctls_changed === false, "Manifest must not claim forwarding sysctls were changed.");
    assert(policy.scope?.production_services_changed === false, "Manifest must not claim production services were changed.");

    assert(policy.source_networks?.length === EXPECTED_SOURCES.length, "Exactly three isolated egress source networks are required.");
    const seenServices = new Set();
    const seenCidrs = new Set();
    for (const expected of EXPECTED_SOURCES) {
        const source = policy.source_networks.find((entry) => entry?.service === expected.service);
        assert(source, "Missing source network for " + expected.service + ".");
        assert(source.source_cidr === expected.source_cidr, "Unexpected source CIDR for " + expected.service + ".");
        validateCidr(source.source_cidr, 4, expected.service + " source_cidr");
        assert(!seenServices.has(source.service), "Duplicate service source: " + source.service);
        assert(!seenCidrs.has(source.source_cidr), "Duplicate egress source CIDR: " + source.source_cidr);
        seenServices.add(source.service);
        seenCidrs.add(source.source_cidr);
        assert(sameArray(source.new_outbound_allow?.protocols, expected.protocols), "Unexpected protocol allowance for " + expected.service + ".");
        assert(sameArray(source.new_outbound_allow?.ports, expected.ports), "Unexpected port allowance for " + expected.service + ".");
    }

    assert(policy.default_policy?.new_outbound_connections === "deny", "New outbound connections must default to deny.");
    assert(policy.default_policy?.unsolicited_inbound_connections === "deny", "Unsolicited inbound connections must default to deny.");
    assert(policy.default_policy?.unrelated_host_and_docker_traffic === "unchanged", "Unrelated host and Docker traffic must remain unchanged.");
    assert(policy.default_policy?.established_return?.action === "allow", "A narrow stateful return-path allowance is required.");
    assert(sameArray(policy.default_policy.established_return.conntrack_states, ["ESTABLISHED", "RELATED"]), "Return-path state must be limited to ESTABLISHED and RELATED.");
    assert(policy.default_policy.established_return.direction === "responses-to-connections-originated-by-egress-services-only", "Return-path rule must be limited to responses to egress-originated connections.");
    assert(policy.default_policy.established_return.destination_scope === "the-three-egress-source-subnets-only", "Return-path rule must be limited to the egress source subnets.");

    const order = policy.evaluation?.new_egress_order;
    assert(Array.isArray(order) && order.length === 3, "New egress evaluation must define exactly three ordered stages.");
    assert(order[0].startsWith("deny baseline non-public"), "Non-public destination denials must run first.");
    assert(order[1].startsWith("allow only the matching source service"), "Service-specific allows must run after destination denials.");
    assert(order[2].startsWith("deny all remaining new outbound"), "Unmatched new outbound traffic must be denied last.");
    assert(policy.evaluation.destination_denials_precede_service_port_allows === true, "Destination denials must precede service port allows.");

    const deny = policy.destination_denials;
    assert(deny?.host_specific_ranges_required === true, "Host-specific destination ranges must be required.");
    assert(Array.isArray(deny.host_specific_ranges) && deny.host_specific_ranges.length === 0, "Unknown host-specific ranges must remain unfilled, not guessed.");
    assert(Array.isArray(deny.host_specific_required_inputs) && deny.host_specific_required_inputs.length >= 5, "Host-specific network and metadata inputs are incomplete.");
    assert(typeof deny.note === "string" && deny.note.includes("incomplete"), "The deny list must be labelled as an incomplete baseline.");
    for (const cidr of REQUIRED_IPV4_BASELINE) assert(deny.ipv4_baseline?.includes(cidr), "Missing IPv4 baseline denial: " + cidr);
    for (const cidr of REQUIRED_IPV6_BASELINE) assert(deny.ipv6_baseline?.includes(cidr), "Missing IPv6 baseline denial: " + cidr);
    assert(new Set(deny.ipv4_baseline).size === deny.ipv4_baseline.length, "IPv4 baseline contains duplicate CIDRs.");
    assert(new Set(deny.ipv6_baseline).size === deny.ipv6_baseline.length, "IPv6 baseline contains duplicate CIDRs.");
    deny.ipv4_baseline.forEach((cidr) => validateCidr(cidr, 4, "IPv4 baseline"));
    deny.ipv6_baseline.forEach((cidr) => validateCidr(cidr, 6, "IPv6 baseline"));

    assert(policy.ipv6?.filtering_required === true, "IPv6 egress filtering must be explicitly required.");
    assert(policy.ipv6?.forwarding_audit_required === true, "IPv6 forwarding state must be audited.");
    assert(policy.ipv6?.must_not_assume_disabled_forwarding_alone_proves_no_path === true, "The policy must not assume that one disabled forwarding sysctl proves no IPv6 path.");
    assert(policy.dns?.arbitrary_dns_egress === "deny", "Arbitrary DNS egress must be denied.");
    assert(policy.dns?.direct_external_dns_from_provider_containers?.startsWith("deny"), "Direct external DNS must be denied unless explicitly approved.");
    assert(typeof policy.dns?.docker_embedded_resolver_path === "string" && policy.dns.docker_embedded_resolver_path.includes("inspect"), "The Docker DNS resolver path requires host-specific inspection.");

    const tunnel = policy.source_networks.find((entry) => entry.service === "cloudflared");
    assert(sameArray(tunnel.new_outbound_allow.hostname_allowlist, EXPECTED_CLOUDFLARE_HOSTS), "Cloudflared must use only the documented standard regional hostname allowlist.");
    assert(tunnel.new_outbound_allow.refresh_before_deployment === true, "Cloudflare endpoint data must be refreshed before deployment.");
    const endpoints = tunnel.new_outbound_allow.endpoint_address_snapshot;
    assert(endpoints && endpoints.ipv4?.length === 20 && endpoints.ipv6?.length === 20, "Cloudflare endpoint snapshot must contain both address families for both standard regions.");
    endpoints.ipv4.forEach((ip) => validateIp(ip, 4, "Cloudflare endpoint snapshot"));
    endpoints.ipv6.forEach((ip) => validateIp(ip, 6, "Cloudflare endpoint snapshot"));
    assert(!tunnel.new_outbound_allow.ports.includes(443), "Optional TCP 443 must not be granted to cloudflared by default.");

    const iptables = policy.backend_attachments?.iptables;
    assert(typeof iptables?.attachment === "string" && iptables.attachment.includes("DOCKER-USER"), "iptables policy must attach through DOCKER-USER.");
    assert(iptables.preserve_existing_chain === true && iptables.do_not_flush_or_replace_docker_user === true && iptables.policy_must_precede_docker_forward_accepts === true, "iptables policy must preserve the existing chain and precede Docker accepts.");
    const nftables = policy.backend_attachments?.nftables;
    assert(typeof nftables?.attachment === "string" && nftables.attachment.includes("forward base chain"), "nftables policy must use a separate forward base chain.");
    assert(nftables.do_not_create_docker_user === true && nftables.do_not_modify_docker_managed_tables === true && nftables.policy_must_precede_docker_forward_accepts === true, "nftables policy must stay separate from Docker-managed tables.");

    assert(Array.isArray(policy.host_preflight_required) && policy.host_preflight_required.length >= 6, "Host-specific preflight requirements are incomplete.");
    const sources = policy.reference_sources || [];
    assert(sources.some((item) => item.publisher === "IANA" && item.url === "https://www.iana.org/assignments/iana-ipv4-special-registry"), "Official IANA IPv4 registry reference is required.");
    assert(sources.some((item) => item.publisher === "IANA" && item.url === "https://www.iana.org/assignments/iana-ipv6-special-registry"), "Official IANA IPv6 registry reference is required.");
    assert(sources.some((item) => item.publisher === "Cloudflare" && item.url === "https://developers.cloudflare.com/tunnel/configuration/"), "Official Cloudflare Tunnel firewall documentation is required.");
    return true;
}

function main() {
    const manifestPath = path.join(__dirname, "host-egress-policy.json");
    try {
        validatePolicy(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    } catch (error) {
        console.error("BOF host egress policy validation failed: " + error.message);
        process.exitCode = 1;
        return;
    }
    console.log("BOF host egress policy manifest valid. Design-only; no host rules were generated or applied.");
}
if (require.main === module) main();
module.exports = { validatePolicy };
