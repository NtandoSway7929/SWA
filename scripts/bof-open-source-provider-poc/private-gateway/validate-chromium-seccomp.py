#!/usr/bin/env python3
"""Validate the constrained Chromium seccomp additions without executing a container."""
import json
import sys
from pathlib import Path

profile_path = Path(__file__).with_name("chromium-seccomp.json")
profile = json.loads(profile_path.read_text(encoding="utf-8"))

def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)

if profile.get("defaultAction") != "SCMP_ACT_ERRNO":
    fail("profile must retain default-deny SCMP_ACT_ERRNO")

rules = profile.get("syscalls")
if not isinstance(rules, list):
    fail("syscalls must be an array")

def matching(name, action=None):
    return [
        rule for rule in rules
        if name in rule.get("names", []) and
        (action is None or rule.get("action") == action)
    ]

def has_filtered_allow(name, index, mask):
    for rule in matching(name, "SCMP_ACT_ALLOW"):
        for arg in rule.get("args", []):
            if (
                arg.get("index") == index and
                arg.get("op") == "SCMP_CMP_MASKED_EQ" and
                arg.get("value") == mask and
                arg.get("valueTwo", 0) == 0
            ):
                return True
    return False

# The mask excludes CLONE_NEWNS, CLONE_NEWCGROUP, CLONE_NEWUTS and CLONE_NEWIPC.
if not has_filtered_allow("clone", 0, 0x0E020000):
    fail("clone must be allowed only with the Chromium namespace flag mask")

# The mask permits unshare(CLONE_NEWUSER) but not other unshare flags.
if not has_filtered_allow("unshare", 0, 0xEFFFFFFF):
    fail("unshare must be restricted to CLONE_NEWUSER")

# clone3 arguments live behind a pointer and cannot be filtered by seccomp BPF.
# Keep the Moby default fallback response so Chromium/glibc can use clone instead.
if not any(
    rule.get("action") == "SCMP_ACT_ERRNO" and
    rule.get("errnoRet") == 38 and
    "clone3" in rule.get("names", [])
    for rule in rules
):
    fail("clone3 must remain denied with ENOSYS (errno 38)")

# Do not introduce a blanket setns allowance or allow mount-related namespace changes.
for name in ("setns", "mount", "mount_setattr", "move_mount", "open_tree", "pivot_root", "umount", "umount2"):
    for rule in matching(name, "SCMP_ACT_ALLOW"):
        if not rule.get("includes", {}).get("caps"):
            fail(f"{name} has an unconditional allow rule")

if not any(
    rule.get("action") == "SCMP_ACT_ALLOW" and
    rule.get("names") == ["chroot"] and
    not rule.get("includes") and not rule.get("excludes")
    for rule in rules
):
    fail("Chromium's chroot allowance is missing")

print("PASS: default-deny seccomp profile retains filtered clone/unshare rules, clone3 ENOSYS, no blanket setns/mount allowance, and the scoped chroot rule.")
