#!/usr/bin/env python3
"""Verify actual Docker HostConfig CPU, memory and PID ceilings."""
import argparse
import json
import sys

EXPECTED = {
    "searxng": {"memory": 1024**3, "nano_cpus": 750_000_000, "pids": 256},
    "crawl4ai": {"memory": 4 * 1024**3, "nano_cpus": 1_500_000_000, "pids": 512},
    "valkey": {"memory": 384 * 1024**2, "nano_cpus": 250_000_000, "pids": 128},
    "gateway": {"memory": 256 * 1024**2, "nano_cpus": 250_000_000, "pids": 128},
    "cloudflared": {"memory": 128 * 1024**2, "nano_cpus": 250_000_000, "pids": 128},
}


def fail(message):
    print("FAIL: " + message, file=sys.stderr)
    raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True, choices=sorted(EXPECTED))
    args = parser.parse_args()
    try:
        document = json.load(sys.stdin)
        inspected = document[0] if isinstance(document, list) else document
        host = inspected.get("HostConfig", {})
        actual = {
            "memory": host.get("Memory"),
            "nano_cpus": host.get("NanoCpus"),
            "pids": host.get("PidsLimit"),
        }
    except Exception as error:
        fail("invalid docker inspect JSON: " + str(error))

    expected = EXPECTED[args.service]
    for key, expected_value in expected.items():
        value = actual.get(key)
        if value is None:
            fail(f"{args.service} runtime {key} limit is not set")
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            fail(f"{args.service} runtime {key} limit is not numeric")
        if numeric != expected_value:
            fail(f"{args.service} runtime {key} limit must be {expected_value}, got {value}")
        print(f"PASS: {args.service} runtime {key}={numeric}")

    print(f"PASS: {args.service} runtime CPU, memory and PID ceilings are enforced in Docker HostConfig")


if __name__ == "__main__":
    main()
