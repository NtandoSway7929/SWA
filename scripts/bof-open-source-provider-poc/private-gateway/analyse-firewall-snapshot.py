#!/usr/bin/env python3
"""Offline, read-only analyser for saved BOF host firewall snapshots.

It reports structural ordering signals only. It never runs host commands,
changes firewall state, or declares a host deployment-ready.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass


@dataclass
class Finding:
    status: str
    message: str


def section(snapshot: str, label: str) -> str:
    marker = f"--- {label} ---"
    if marker not in snapshot:
        return ""
    tail = snapshot.split(marker, 1)[1]
    next_marker = re.search(r"\n--- .+? ---\n", tail)
    return tail[: next_marker.start()] if next_marker else tail


def analyse_iptables(snapshot: str) -> list[Finding]:
    findings: list[Finding] = []
    forward = section(snapshot, "IPv4 filter FORWARD chain")
    user = section(snapshot, "IPv4 DOCKER-USER chain")
    if not forward:
        return [Finding("FAIL", "IPv4 FORWARD snapshot is missing; ordering cannot be assessed.")]
    rules = [line.strip() for line in forward.splitlines()
             if line.strip().startswith("-A FORWARD ")]
    user_jump = next((i for i, rule in enumerate(rules)
                      if re.search(r"(?:-j|-g)\s+DOCKER-USER(?:\s|$)", rule)), None)
    if user_jump is None:
        findings.append(Finding("FAIL", "FORWARD has no visible jump to DOCKER-USER."))
    elif user_jump != 0:
        findings.append(Finding("FAIL", "DOCKER-USER is not the first FORWARD rule; earlier rules may accept or bypass traffic."))
    else:
        findings.append(Finding("PASS", "DOCKER-USER is the first visible FORWARD rule."))

    if not user:
        findings.append(Finding("FAIL", "IPv4 DOCKER-USER snapshot is missing or unreadable."))
    else:
        user_rules = [line.strip() for line in user.splitlines()
                      if line.strip().startswith("-A DOCKER-USER ")]
        if not user_rules:
            findings.append(Finding("REVIEW", "DOCKER-USER has no captured rules; no BOF policy attachment is evidenced."))
        else:
            policy_jumps = [r for r in user_rules if re.search(r"(?:-j|-g)\s+(?:SWAYPHICS|BOF)[A-Za-z0-9_-]*(?:\s|$)", r, re.I)]
            if policy_jumps:
                findings.append(Finding("REVIEW", "A BOF/Swayphics-named policy jump exists; inspect its full rule order and referenced chain manually."))
            else:
                findings.append(Finding("REVIEW", "DOCKER-USER contains rules, but no clearly named BOF policy jump is evidenced."))
            if any(re.search(r"(?:-j|-g)\s+RETURN(?:\s|$)", r) for r in user_rules):
                findings.append(Finding("REVIEW", "DOCKER-USER contains RETURN; verify no traffic can return before the intended policy runs."))
    return findings


def _priority_value(raw: str) -> int | None:
    """Resolve nftables integer, named, and relative named priorities."""
    raw = raw.strip().strip(";")
    named = {"raw": -300, "mangle": -150, "dstnat": -100,
             "filter": 0, "security": 50, "srcnat": 100}
    match = re.fullmatch(
        r"([A-Za-z]+|[+-]?\d+)(?:\s*([+-])\s*(\d+))?", raw
    )
    if not match:
        return None
    base_token, operator, offset_token = match.groups()
    if base_token in named:
        base = named[base_token]
    else:
        try:
            base = int(base_token)
        except ValueError:
            return None
    if operator and offset_token:
        offset = int(offset_token)
        base = base + offset if operator == "+" else base - offset
    return base


def parse_nft_forward_chains(snapshot: str) -> list[tuple[str, str, int]]:
    """Return (table, chain, priority) for visible forward base chains."""
    tables: list[tuple[str, str, int]] = []
    current_table = ""
    current_chain = ""
    chain_lines: list[str] = []
    depth = 0
    for line in snapshot.splitlines():
        table_match = re.match(r"\s*table\s+\S+\s+([^\s{]+)\s*\{", line)
        if table_match:
            current_table = table_match.group(1)
        chain_match = re.match(r"\s*chain\s+([^\s{]+)\s*\{", line)
        if chain_match:
            current_chain = chain_match.group(1)
            chain_lines = []
            depth = 1
            remainder = line.split("{", 1)[1]
            if "}" in remainder:
                depth = 0
        elif current_chain:
            chain_lines.append(line)
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                body = " ".join(chain_lines)
                if re.search(r"\bhook\s+forward\b", body):
                    priority_match = re.search(r"\bpriority\s+([^;]+?)\s*;", body)
                    if priority_match:
                        priority = _priority_value(priority_match.group(1))
                        if priority is not None:
                            tables.append((current_table, current_chain, priority))
                current_chain = ""
                chain_lines = []
    return tables


def analyse_nft(snapshot: str) -> list[Finding]:
    chains = parse_nft_forward_chains(snapshot)
    if not chains:
        return [Finding("FAIL", "No readable nftables forward base-chain priorities were found.")]
    admin = [item for item in chains if item[0].lower() in {"swayphics_bof", "bof_swayphics"}]
    docker = [item for item in chains if "docker" in item[0].lower()]
    if not admin:
        return [Finding("REVIEW", "No administrator-owned BOF forward base chain is visible; no enforcement ordering is evidenced.")]
    if not docker:
        return [Finding("REVIEW", "BOF forward chain is visible, but no Docker-owned forward base chain could be identified reliably.")]
    admin_priority = min(item[2] for item in admin)
    docker_priority = min(item[2] for item in docker)
    if admin_priority < docker_priority:
        return [Finding("PASS", f"BOF forward priority ({admin_priority}) precedes the visible Docker forward priority ({docker_priority}).")]
    return [Finding("FAIL", f"BOF forward priority ({admin_priority}) does not precede Docker forward priority ({docker_priority}).")]


def analyse(snapshot: str) -> tuple[str, list[Finding]]:
    backend_match = re.search(r"^Docker firewall backend:\s*(iptables|nftables)\s*$",
                              snapshot, re.M | re.I)
    if not backend_match:
        return "UNKNOWN", [Finding("FAIL", "Snapshot does not contain a recognised Docker firewall backend marker.")]
    backend = backend_match.group(1).lower()
    findings = analyse_iptables(snapshot) if backend == "iptables" else analyse_nft(snapshot)
    return backend, findings


def render(backend: str, findings: list[Finding]) -> str:
    lines = [f"Firewall snapshot analysis: {backend}"]
    for finding in findings:
        lines.append(f"{finding.status}: {finding.message}")
    if any(item.status == "FAIL" for item in findings):
        overall = "FAIL"
    elif any(item.status == "REVIEW" for item in findings):
        overall = "REVIEW"
    else:
        overall = "PASS"
    lines.extend([f"Structural assessment: {overall}",
                  "DEPLOYMENT GATE: NOT READY",
                  "Scope: offline structural review only; rule semantics, packet paths, DNS, IPv6 policy completeness and host-specific risks require manual/staging verification."])
    return "\n".join(lines)


def self_test() -> None:
    iptables_good = """Read-only host firewall state audit
Docker firewall backend: iptables
--- IPv4 filter FORWARD chain ---
-P FORWARD DROP
-A FORWARD -j DOCKER-USER
-A FORWARD -j DOCKER-FORWARD
--- IPv4 DOCKER-USER chain ---
-N DOCKER-USER
-A DOCKER-USER -j SWAYPHICS_BOF
-A DOCKER-USER -j RETURN
"""
    backend, findings = analyse(iptables_good)
    assert backend == "iptables" and findings[0].status == "PASS"
    assert any(x.status == "REVIEW" for x in findings)
    iptables_bad = iptables_good.replace("-A FORWARD -j DOCKER-USER\n-A FORWARD -j DOCKER-FORWARD",
                                         "-A FORWARD -j DOCKER-FORWARD\n-A FORWARD -j DOCKER-USER")
    _, findings = analyse(iptables_bad)
    assert findings[0].status == "FAIL"
    iptables_missing = iptables_good.replace("-A FORWARD -j DOCKER-USER\n", "")
    _, findings = analyse(iptables_missing)
    assert findings[0].status == "FAIL"

    nft_good = """Read-only host firewall state audit
Docker firewall backend: nftables
table inet swayphics_bof {
 chain forward {
  type filter hook forward priority -10; policy accept;
 }
}
table ip docker-bridges {
 chain forward {
  type filter hook forward priority filter; policy accept;
 }
}
"""
    backend, findings = analyse(nft_good)
    assert backend == "nftables" and findings[0].status == "PASS"
    nft_bad = nft_good.replace("priority -10", "priority 0")
    _, findings = analyse(nft_bad)
    assert findings[0].status == "FAIL"
    nft_relative_earlier = nft_good.replace("priority -10", "priority filter - 1")
    _, findings = analyse(nft_relative_earlier)
    assert findings[0].status == "PASS"
    nft_relative_later = nft_good.replace("priority -10", "priority filter + 1")
    _, findings = analyse(nft_relative_later)
    assert findings[0].status == "FAIL"
    assert _priority_value("filter - 5") == -5
    assert _priority_value("mangle + 10") == -140
    assert _priority_value("not-a-priority") is None
    nft_unknown = nft_good.replace("table ip docker-bridges", "table ip other")
    _, findings = analyse(nft_unknown)
    assert findings[0].status == "REVIEW"
    assert "DEPLOYMENT GATE: NOT READY" in render("iptables", [Finding("PASS", "fixture")])
    print("PASS firewall snapshot analyser self-tests")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", nargs="?", help="saved audit-host-firewall-state.sh output; defaults to stdin")
    parser.add_argument("--self-test", action="store_true", help="run offline parser regression tests")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    try:
        if args.snapshot:
            with open(args.snapshot, "r", encoding="utf-8") as handle:
                snapshot = handle.read()
        else:
            snapshot = sys.stdin.read()
    except OSError as exc:
        print(f"Could not read snapshot: {exc}", file=sys.stderr)
        return 2
    backend, findings = analyse(snapshot)
    print(render(backend, findings))
    return 1 if any(item.status == "FAIL" for item in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
