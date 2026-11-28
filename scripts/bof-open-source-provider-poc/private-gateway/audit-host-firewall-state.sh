#!/usr/bin/env bash
set -euo pipefail

# Read-only snapshot for firewall-policy design. No commands in this file change state.
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_AUDIT="$SCRIPT_DIR/audit-host-firewall-backend.sh"

if [[ ! -f "$BACKEND_AUDIT" ]]; then
    echo "The Docker firewall backend audit script is missing." >&2
    exit 2
fi

if ! backend_report="$(bash "$BACKEND_AUDIT" 2>&1)"; then
    echo "Could not identify a supported Docker firewall backend:" >&2
    printf '%s\n' "$backend_report" >&2
    exit 2
fi

case "$backend_report" in
    *"Detected Docker firewall backend: iptables."*) backend="iptables" ;;
    *"Detected Docker firewall backend: nftables."*) backend="nftables" ;;
    *)
        echo "The backend audit returned no recognised backend marker." >&2
        exit 2
        ;;
esac

if ! command -v sysctl >/dev/null 2>&1; then
    echo "sysctl is required to inspect IPv4 and IPv6 forwarding state." >&2
    exit 2
fi

read_sysctl() {
    local key="$1"
    local value

    if ! value="$(sysctl -n "$key" 2>/dev/null)"; then
        echo "Could not read sysctl $key; host forwarding state is unknown." >&2
        return 2
    fi

    value="$(printf '%s' "$value" | tr -d '\r\n')"
    if [[ "$value" != "0" && "$value" != "1" ]]; then
        echo "Unexpected value for sysctl $key: $value" >&2
        return 2
    fi

    printf '%s' "$value"
}

capture_required() {
    local label="$1"
    shift
    local output

    if ! output="$("$@" 2>&1)"; then
        echo "Could not inspect $label; firewall state is incomplete." >&2
        printf '%s\n' "$output" >&2
        return 2
    fi

    printf '\n--- %s ---\n' "$label"
    if [[ -n "$output" ]]; then
        printf '%s\n' "$output"
    else
        printf '(empty output)\n'
    fi
}

capture_optional_chain() {
    local label="$1"
    shift
    local output

    if output="$("$@" 2>&1)"; then
        printf '\n--- %s ---\n' "$label"
        if [[ -n "$output" ]]; then
            printf '%s\n' "$output"
        else
            printf '(empty output)\n'
        fi
    else
        printf '\n--- %s ---\n' "$label"
        printf 'Chain is not present or is not readable; manual review is required.\n'
        if [[ -n "$output" ]]; then
            printf '%s\n' "$output"
        fi
    fi
}

ipv4_forward="$(read_sysctl net.ipv4.ip_forward)" || exit 2
ipv6_forward="$(read_sysctl net.ipv6.conf.all.forwarding)" || exit 2

printf 'Read-only host firewall state audit\n'
printf 'Docker firewall backend: %s\n' "$backend"
printf 'net.ipv4.ip_forward=%s\n' "$ipv4_forward"
printf 'net.ipv6.conf.all.forwarding=%s\n' "$ipv6_forward"

if [[ "$backend" == "iptables" ]]; then
    command -v iptables >/dev/null 2>&1 || {
        echo "iptables is required for the Docker-reported iptables backend." >&2
        exit 2
    }
    command -v ip6tables >/dev/null 2>&1 || {
        echo "ip6tables is required to review IPv6 forwarding state." >&2
        exit 2
    }

    capture_required "IPv4 filter FORWARD chain" iptables -S FORWARD
    capture_required "IPv4 DOCKER-USER chain" iptables -S DOCKER-USER
    capture_required "IPv4 Docker NAT chain" iptables -t nat -S DOCKER
    capture_required "IPv6 filter FORWARD chain" ip6tables -S FORWARD
    capture_optional_chain "IPv6 DOCKER-USER chain" ip6tables -S DOCKER-USER
else
    command -v nft >/dev/null 2>&1 || {
        echo "nft is required for the Docker-reported nftables backend." >&2
        exit 2
    }
    capture_required "Complete nftables ruleset including handles and chain priorities" nft -a list ruleset
fi

printf '\nRead-only audit complete. No firewall rules, sysctls, routes, or Docker settings were changed.\n'
printf 'Review this snapshot before designing any host-specific enforcement policy.\n'
