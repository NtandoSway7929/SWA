#!/usr/bin/env bash
set -uo pipefail

# Read-only BOF host preflight. Raw inventory output is suppressed by default.
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_AUDIT="$SCRIPT_DIR/audit-host-firewall-backend.sh"
OVERLAP_AUDIT="$SCRIPT_DIR/audit-host-network-overlap.py"
FIREWALL_AUDIT="$SCRIPT_DIR/audit-host-firewall-state.sh"
APPARMOR_AUDIT="$SCRIPT_DIR/audit-host-apparmor.sh"
POLICY_VALIDATOR="$SCRIPT_DIR/validate-host-egress-policy.cjs"

argument="${1-}"
show_details=false
case "$argument" in
    "")
        ;;
    --show-details)
        show_details=true
        ;;
    --help|-h)
        echo "Usage: bash audit-host-readiness.sh [--show-details]"
        echo "Runs read-only BOF policy, Docker backend, subnet-overlap, firewall-state and AppArmor audits."
        echo "Raw host topology and firewall output is suppressed unless --show-details is used."
        exit 0
        ;;
    *)
        echo "Unknown option: $argument" >&2
        echo "Usage: bash audit-host-readiness.sh [--show-details]" >&2
        exit 3
        ;;
esac
if [[ "$#" -gt 1 ]]; then
    echo "Only one option is accepted." >&2
    exit 3
fi

capture() {
    local target="$1"
    shift
    local output
    local status
    if output="$("$@" 2>&1)"; then status=0; else status=$?; fi
    printf -v "$target" '%s' "$output"
    return "$status"
}

policy_output=""
backend_output=""
overlap_output=""
firewall_output=""
apparmor_output=""
policy_status=0
backend_status=0
overlap_status=0
firewall_status=0
apparmor_status=0

if capture policy_output node "$POLICY_VALIDATOR"; then policy_status=0; else policy_status=$?; fi
if capture backend_output bash "$BACKEND_AUDIT"; then backend_status=0; else backend_status=$?; fi
if capture overlap_output python3 "$OVERLAP_AUDIT"; then overlap_status=0; else overlap_status=$?; fi
if capture apparmor_output bash "$APPARMOR_AUDIT"; then apparmor_status=0; else apparmor_status=$?; fi

backend_name="unknown"
if [[ "$backend_status" -eq 0 ]]; then
    backend_name="$(printf '%s\n' "$backend_output" | sed -n 's/^Detected Docker firewall backend: \(iptables\|nftables\)\.$/\1/p' | head -n 1)"
    if [[ -z "$backend_name" ]]; then backend_name="unknown"; backend_status=2; fi
fi

if [[ "$backend_status" -eq 0 ]]; then
    if capture firewall_output bash "$FIREWALL_AUDIT"; then firewall_status=0; else firewall_status=$?; fi
else
    firewall_status=2
    firewall_output="Skipped because the Docker firewall backend could not be identified."
fi

ipv4_forward="$(printf '%s\n' "$firewall_output" | sed -n 's/^net\.ipv4\.ip_forward=//p' | head -n 1)"
ipv6_forward="$(printf '%s\n' "$firewall_output" | sed -n 's/^net\.ipv6\.conf\.all\.forwarding=//p' | head -n 1)"
ipv6_manual_review=false
if [[ "$firewall_output" == *"manual review is required"* ]]; then ipv6_manual_review=true; fi

echo
echo "BOF PRIVATE PROVIDER HOST READINESS"
echo "Mode: read-only preflight"
printf 'Policy manifest: '
if [[ "$policy_status" -eq 0 ]]; then echo "PASS"; else echo "INCOMPLETE (validator exit $policy_status)"; fi

printf 'Docker firewall backend: '
if [[ "$backend_status" -eq 0 ]]; then echo "PASS ($backend_name)"; else echo "INCOMPLETE (backend audit exit $backend_status)"; fi

printf 'Host subnet-overlap audit: '
case "$overlap_status" in
    0) echo "PASS (no overlap detected in the available inventory)" ;;
    1) echo "CONFLICT (one or more planned subnets overlap observed host ranges)" ;;
    *) echo "INCOMPLETE (inventory or Docker context could not be trusted; exit $overlap_status)" ;;
esac

printf 'Firewall and forwarding snapshot: '
if [[ "$firewall_status" -eq 0 ]]; then
    echo "READABLE (this is not a firewall policy validation)"
    [[ -n "$ipv4_forward" ]] && echo "IPv4 forwarding sysctl: $ipv4_forward"
    [[ -n "$ipv6_forward" ]] && echo "IPv6 forwarding sysctl: $ipv6_forward"
    if [[ "$ipv6_manual_review" == true ]]; then echo "IPv6 DOCKER-USER chain: manual review required"; fi
elif [[ "$backend_status" -ne 0 ]]; then
    echo "SKIPPED (unsupported or unreadable backend)"
else
    echo "INCOMPLETE (snapshot audit exit $firewall_status)"
fi

printf 'Crawl4AI AppArmor profile: '
if [[ "$apparmor_status" -eq 0 ]]; then
    echo "PASS (loaded/enforced; host userns restriction enabled)"
else
    echo "INCOMPLETE (AppArmor audit exit $apparmor_status)"
fi

if [[ "$show_details" == true ]]; then
    echo "Raw host details: included below; treat this output as sensitive"
else
    echo "Raw host details: suppressed (use --show-details only on a trusted terminal)"
fi

echo
echo "DEPLOYMENT GATE: NOT READY"
echo "This report does not apply rules, prove that existing rules are safe, or authorise deployment."
echo "Still required: host-specific LAN/VPN/Docker/metadata ranges, external control-plane review,"
echo "staged IPv4/IPv6 and DNS-rebinding/redirect tests, verified egress enforcement, and rollback evidence."

if [[ "$show_details" == true ]]; then
    printf '\n===== Policy validator output =====\n%s\n' "$policy_output"
    printf '\n===== Docker firewall backend audit output =====\n%s\n' "$backend_output"
    printf '\n===== Host subnet-overlap audit output =====\n%s\n' "$overlap_output"
    printf '\n===== Firewall and forwarding snapshot output =====\n%s\n' "$firewall_output"
fi

# Exit 0 means inventory checks passed, not deployment readiness.
if [[ "$overlap_status" -eq 1 ]]; then exit 1; fi
if [[ "$policy_status" -ne 0 || "$backend_status" -ne 0 || "$overlap_status" -ne 0 || "$firewall_status" -ne 0 || "$apparmor_status" -ne 0 ]]; then exit 2; fi
exit 0
