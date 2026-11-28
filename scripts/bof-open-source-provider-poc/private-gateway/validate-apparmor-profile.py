#!/usr/bin/env python3
"""Static guardrails for the dedicated Crawl4AI AppArmor userns profile."""
from pathlib import Path
import sys

profile_path = Path(__file__).with_name("apparmor-crawl4ai.profile")
profile = profile_path.read_text(encoding="utf-8")

required = (
    'profile "swayphics-bof-crawl4ai" flags=(attach_disconnected,mediate_deleted)',
    "userns,",
    "deny network alg,",
    "deny network vsock,",
    "deny mount,",
    "deny @{PROC}/sys/[^k]** w",
    "deny @{PROC}/kcore rwklx",
    "deny /sys/kernel/security/** rwklx",
)
for rule in required:
    if rule not in profile:
        print(f"FAIL: AppArmor profile is missing required rule: {rule}", file=sys.stderr)
        raise SystemExit(1)

for forbidden in ("flags=(unconfined)", "capability sys_admin,", "change_profile"):
    if forbidden in profile:
        print(f"FAIL: AppArmor profile contains an unsafe broadening token: {forbidden}", file=sys.stderr)
        raise SystemExit(1)

if profile.count("userns,") != 1:
    print("FAIL: profile must contain exactly one userns permission rule", file=sys.stderr)
    raise SystemExit(1)

print("PASS: dedicated AppArmor profile retains Docker-derived confinement and adds only one explicit userns permission.")
