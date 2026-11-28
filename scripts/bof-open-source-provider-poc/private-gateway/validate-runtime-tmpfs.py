#!/usr/bin/env python3
"""Check Docker-inspected tmpfs size ceilings for gateway containers."""
import argparse
import json
import sys

EXPECTED = {
    "crawl4ai": {
        "/tmp": 512 * 1024**2,
        "/var/lib/redis": 128 * 1024**2,
        "/var/lib/crawl4ai/outputs": 256 * 1024**2,
        "/home/appuser/.crawl4ai": 64 * 1024**2,
        "/home/appuser/.cache/url_seeder": 64 * 1024**2,
        "/home/appuser/.gunicorn": 64 * 1024**2,
    },
    "gateway": {
        "/data": 32 * 1024**2,
        "/config": 8 * 1024**2,
        "/tmp": 32 * 1024**2,
    },
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
        mounts = inspected.get("HostConfig", {}).get("Tmpfs") or {}
    except Exception as error:
        fail("invalid docker inspect JSON: " + str(error))

    for target, expected_size in EXPECTED[args.service].items():
        options = mounts.get(target)
        if not isinstance(options, str):
            fail(f"{args.service} is missing tmpfs mount {target}")
        parsed = {}
        for item in options.split(","):
            if "=" in item:
                key, value = item.split("=", 1)
                parsed[key] = value
        try:
            actual_size = int(parsed.get("size", ""))
        except ValueError:
            fail(f"{args.service} tmpfs {target} has no explicit numeric size; Docker reported {options!r}")
        if actual_size != expected_size:
            fail(f"{args.service} tmpfs {target} must be {expected_size} bytes, got {actual_size}")
        print(f"PASS: {args.service} tmpfs {target} size={actual_size} bytes")

    print(f"PASS: {args.service} runtime tmpfs mounts are explicitly size-bounded")


if __name__ == "__main__":
    main()
