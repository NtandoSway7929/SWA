#!/usr/bin/env bash
set -euo pipefail

# Read-only inspection. This script never changes host firewall rules.
if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to identify the active Docker firewall backend." >&2
    exit 2
fi

if ! docker_info="$(docker info 2>&1)"; then
    echo "Could not read Docker daemon information. Check Docker access and permissions." >&2
    exit 2
fi

backend="$(printf '%s\n' "$docker_info" | awk -F: '
    /^[[:space:]]*Firewall Backend:/ {
        value = $2
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print tolower(value)
        exit
    }
')"

case "$backend" in
    iptables)
        if ! command -v iptables >/dev/null 2>&1; then
            echo "Docker reports iptables, but the iptables command is unavailable." >&2
            exit 2
        fi
        if ! iptables -S DOCKER-USER >/dev/null 2>&1; then
            echo "Docker reports iptables, but the DOCKER-USER chain is not readable." >&2
            exit 2
        fi
        echo "Detected Docker firewall backend: iptables."
        echo "Administrator policy insertion point: DOCKER-USER (filter/FORWARD)."
        echo "Do not append rules after Docker's own forwarding accepts."
        ;;
    nftables)
        if ! command -v nft >/dev/null 2>&1; then
            echo "Docker reports nftables, but the nft command is unavailable." >&2
            exit 2
        fi
        if ! nft list tables >/dev/null 2>&1; then
            echo "Docker reports nftables, but the nftables ruleset is not readable." >&2
            exit 2
        fi
        echo "Detected Docker firewall backend: nftables."
        echo "Use a separate administrator-owned nftables table with a forward base chain."
        echo "Do not create DOCKER-USER or edit Docker-managed nftables tables."
        ;;
    *)
        echo "Could not identify the Docker firewall backend from docker info." >&2
        echo "Inspect the Docker daemon configuration and firewall rules manually; do not guess." >&2
        exit 2
        ;;
esac

echo "Read-only audit complete. No firewall rules were changed."
