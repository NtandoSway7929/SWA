#!/usr/bin/env python3
"""Read-only preflight for the BOF private-gateway Docker subnet allocation."""

from __future__ import annotations

import ipaddress
import json
import subprocess
import sys
from typing import Any


PLANNED_SUBNETS = (
    ipaddress.ip_network("10.77.30.0/24"),
    ipaddress.ip_network("10.77.10.0/24"),
    ipaddress.ip_network("10.77.20.0/24"),
    ipaddress.ip_network("10.77.40.0/24"),
    ipaddress.ip_network("10.77.50.0/24"),
    ipaddress.ip_network("10.77.60.0/24"),
)


class AuditError(RuntimeError):
    """Raised when the host inventory cannot be trusted."""


def run_command(argv: list[str], label: str) -> str:
    try:
        result = subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise AuditError(f"Could not execute {label}: {error}") from error

    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit status {result.returncode}"
        raise AuditError(f"Could not read {label}: {detail}")

    return result.stdout


def load_json_output(raw: str, label: str) -> list[Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise AuditError(f"{label} did not return valid JSON: {error}") from error

    if not isinstance(value, list):
        raise AuditError(f"{label} returned an unexpected JSON shape; expected an array.")

    return value


def address_inventory() -> list[tuple[str, ipaddress._BaseNetwork, str]]:
    raw = run_command(["ip", "-j", "address", "show"], "host interface addresses")
    links = load_json_output(raw, "ip -j address show")
    inventory: list[tuple[str, ipaddress._BaseNetwork, str]] = []

    for link in links:
        if not isinstance(link, dict):
            raise AuditError("Host interface address output contains a non-object entry.")

        interface_name = str(link.get("ifname") or "unknown-interface")
        addr_info = link.get("addr_info", [])
        if addr_info is None:
            addr_info = []
        if not isinstance(addr_info, list):
            raise AuditError(f"Address list for {interface_name} is malformed.")

        for entry in addr_info:
            if not isinstance(entry, dict):
                raise AuditError(f"Address entry for {interface_name} is malformed.")

            family = entry.get("family")
            if family not in ("inet", "inet6"):
                continue

            local = entry.get("local")
            prefixlen = entry.get("prefixlen")
            if not isinstance(local, str) or not isinstance(prefixlen, int):
                raise AuditError(f"Address or prefix length for {interface_name} is missing.")

            address_value = local.split("%", 1)[0]
            try:
                interface = ipaddress.ip_interface(f"{address_value}/{prefixlen}")
            except ValueError as error:
                raise AuditError(
                    f"Could not parse address {local}/{prefixlen} on {interface_name}: {error}"
                ) from error

            expected_version = 4 if family == "inet" else 6
            if interface.version != expected_version:
                raise AuditError(
                    f"Address family mismatch for {local}/{prefixlen} on {interface_name}."
                )

            inventory.append((
                f"host interface {interface_name}",
                interface.network,
                f"{local}/{prefixlen}",
            ))

    return inventory


def route_inventory(family: int) -> list[tuple[str, ipaddress._BaseNetwork, str]]:
    raw = run_command(
        ["ip", "-j", f"-{family}", "route", "show", "table", "all"],
        f"IPv{family} host routes",
    )
    routes = load_json_output(raw, f"ip -j -{family} route show table all")
    inventory: list[tuple[str, ipaddress._BaseNetwork, str]] = []

    for route in routes:
        if not isinstance(route, dict):
            raise AuditError(f"IPv{family} route output contains a non-object entry.")

        destination = route.get("dst") or "default"
        if destination == "default":
            continue

        try:
            network = ipaddress.ip_network(destination, strict=False)
        except ValueError as error:
            raise AuditError(f"Could not parse IPv{family} route {destination!r}: {error}") from error

        if network.version != family:
            raise AuditError(
                f"IPv{family} route command returned a different address family: {destination}"
            )

        if network.prefixlen == 0:
            continue

        device = route.get("dev") or route.get("table") or "unknown"
        inventory.append((f"IPv{family} route via {device}", network, destination))

    return inventory


def docker_network_inventory() -> list[tuple[str, ipaddress._BaseNetwork, str]]:
    ids_output = run_command(["docker", "network", "ls", "-q"], "Docker network list")
    network_ids = [line.strip() for line in ids_output.splitlines() if line.strip()]
    if not network_ids:
        return []

    raw = run_command(["docker", "network", "inspect", *network_ids], "Docker network IPAM")
    networks = load_json_output(raw, "docker network inspect")
    if len(networks) != len(network_ids):
        raise AuditError(
            "Docker returned a different number of inspected networks than requested; "
            "the network inventory may have changed during the audit."
        )

    inventory: list[tuple[str, ipaddress._BaseNetwork, str]] = []
    for network in networks:
        if not isinstance(network, dict):
            raise AuditError("Docker network inspection contains a non-object entry.")

        name = str(network.get("Name") or network.get("Id") or "unnamed-network")
        ipam = network.get("IPAM")
        if not isinstance(ipam, dict):
            raise AuditError(f"IPAM data for Docker network {name!r} is missing or malformed.")

        configs = ipam.get("Config", [])
        if configs is None:
            configs = []
        if not isinstance(configs, list):
            raise AuditError(f"IPAM subnet list for Docker network {name!r} is malformed.")

        for config in configs:
            if not isinstance(config, dict):
                raise AuditError(f"IPAM entry for Docker network {name!r} is malformed.")

            subnet = config.get("Subnet")
            if not subnet:
                continue

            try:
                network_range = ipaddress.ip_network(subnet, strict=False)
            except ValueError as error:
                raise AuditError(
                    f"Could not parse Docker network {name!r} subnet {subnet!r}: {error}"
                ) from error

            inventory.append((f"Docker network {name}", network_range, str(subnet)))

    return inventory


def main() -> int:
    try:
        observed = (
            address_inventory()
            + route_inventory(4)
            + route_inventory(6)
            + docker_network_inventory()
        )
    except AuditError as error:
        print(f"ERROR: Host network audit incomplete: {error}", file=sys.stderr)
        print("No clean result can be reported. Resolve the inventory error and rerun.", file=sys.stderr)
        return 2

    conflicts: list[str] = []
    for planned in PLANNED_SUBNETS:
        for source, observed_network, detail in observed:
            if planned.version == observed_network.version and planned.overlaps(observed_network):
                conflicts.append(
                    f"planned {planned} overlaps {source} range "
                    f"{observed_network} (reported as {detail})"
                )

    print("BOF private-gateway planned subnets:")
    for planned in PLANNED_SUBNETS:
        print(f"  - {planned}")
    print(
        "Inventoried "
        f"{sum(1 for item in observed if item[0].startswith('host interface'))} interface prefixes, "
        f"{sum(1 for item in observed if ' route via ' in item[0])} non-default routes, and "
        f"{sum(1 for item in observed if item[0].startswith('Docker network'))} Docker IPAM subnets."
    )

    if conflicts:
        print("CONFLICT: do not create the private-gateway networks until every overlap is resolved.")
        for conflict in conflicts:
            print(f"  - {conflict}")
        return 1

    print("PASS: no overlap detected with host interface prefixes, routes, or existing Docker networks.")
    print("Read-only audit complete. No network, route, Docker, or firewall settings were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
