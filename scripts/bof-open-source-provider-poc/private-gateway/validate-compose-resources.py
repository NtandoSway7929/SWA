#!/usr/bin/env python3
"""Validate explicit, bounded CPU/memory/PID ceilings in rendered Docker Compose JSON."""
import json
import sys

EXPECTED = {
    "searxng": {"memory": 1024**3, "cpus": 0.75, "pids": 256},
    "crawl4ai": {"memory": 4 * 1024**3, "cpus": 1.5, "pids": 512},
    "valkey": {"memory": 384 * 1024**2, "cpus": 0.25, "pids": 128},
    "gateway": {"memory": 256 * 1024**2, "cpus": 0.25, "pids": 128},
    "cloudflared": {"memory": 128 * 1024**2, "cpus": 0.25, "pids": 128},
}
MAX_TOTAL_MEMORY = 6 * 1024**3
MAX_TOTAL_CPUS = 3.0


def fail(message):
    print("FAIL: " + message, file=sys.stderr)
    raise SystemExit(1)


def main():
    try:
        compose = json.load(sys.stdin)
    except Exception as error:
        fail("could not parse rendered Compose JSON: " + str(error))

    services = compose.get("services")
    if not isinstance(services, dict):
        fail("rendered Compose document has no services object")

    total_memory = 0
    total_cpus = 0.0
    for name, expected in EXPECTED.items():
        service = services.get(name)
        if not isinstance(service, dict):
            fail("required service is missing: " + name)
        deploy = service.get("deploy") or {}
        resources = deploy.get("resources") or {}
        limits = resources.get("limits") or {}
        actual = {
            "memory": limits.get("memory"),
            "cpus": limits.get("cpus"),
            "pids": limits.get("pids"),
        }
        if any(value is None for value in actual.values()):
            fail(name + " must define memory, CPU and PID limits")
        if actual["memory"] != expected["memory"]:
            fail(f"{name} memory limit must be {expected['memory']} bytes, got {actual['memory']}")
        if float(actual["cpus"]) != expected["cpus"]:
            fail(f"{name} CPU limit must be {expected['cpus']}, got {actual['cpus']}")
        if actual["pids"] != expected["pids"]:
            fail(f"{name} PID limit must be {expected['pids']}, got {actual['pids']}")
        total_memory += actual["memory"]
        total_cpus += float(actual["cpus"])
        print(f"PASS: {name} memory={actual['memory']}B cpus={actual['cpus']} pids={actual['pids']}")

    if total_memory > MAX_TOTAL_MEMORY:
        fail(f"aggregate memory ceiling exceeds {MAX_TOTAL_MEMORY} bytes: {total_memory}")
    if total_cpus > MAX_TOTAL_CPUS:
        fail(f"aggregate CPU ceiling exceeds {MAX_TOTAL_CPUS}: {total_cpus}")

    print(f"PASS: aggregate hard ceilings memory={total_memory}B ({total_memory / 1024**3:.2f} GiB), CPUs={total_cpus:.2f}")
    print("NOTE: these are container ceilings, not a host capacity guarantee; reserve RAM/CPU for the OS, Docker and filesystem cache.")


if __name__ == "__main__":
    main()
