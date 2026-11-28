#!/usr/bin/env python3
"""Observe Chromium sandbox processes through Docker's host-visible PID table.

This is a disposable CI diagnostic. It reads process metadata only and makes no
host configuration changes.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import time


def read_status(pid: int) -> dict[str, str]:
    values: dict[str, str] = {}
    with open(f"/proc/{pid}/status", encoding="utf-8") as handle:
        for line in handle:
            if ":" in line:
                key, value = line.split(":", 1)
                values[key] = value.strip()
    return values


def observe(container: str, output: Path, stop_file: Path, interval: float) -> int:
    init_pid = int(subprocess.check_output(
        ["docker", "inspect", "--format", "{{.State.Pid}}", container],
        text=True,
    ).strip())
    container_user_ns = os.stat(f"/proc/{init_pid}/ns/user").st_ino
    seen: set[tuple[int, str]] = set()
    renderer_count = 0

    with output.open("w", encoding="utf-8") as log:
        while not stop_file.exists():
            try:
                listing = subprocess.check_output(
                    ["docker", "top", container, "-eo", "pid,args"],
                    text=True,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.CalledProcessError):
                time.sleep(interval)
                continue

            for line in listing.splitlines()[1:]:
                fields = line.strip().split(None, 1)
                if len(fields) != 2 or not fields[0].isdigit():
                    continue
                pid = int(fields[0])
                command = fields[1]
                lowered = command.lower()
                if "chrom" not in lowered:
                    continue

                is_renderer = "--type=renderer" in lowered
                is_zygote = "--type=zygote" in lowered
                is_gpu = "--type=gpu-process" in lowered
                if not (is_renderer or is_zygote or is_gpu or "--no-sandbox" in lowered):
                    continue

                key = (pid, command)
                if key in seen:
                    continue
                seen.add(key)
                try:
                    status = read_status(pid)
                    user_ns = os.stat(f"/proc/{pid}/ns/user").st_ino
                except (OSError, PermissionError, ProcessLookupError):
                    continue

                record = (
                    f"PID={pid} RENDERER={is_renderer} ZYGOTE={is_zygote} GPU={is_gpu} "
                    f"{command} SECCOMP={status.get('Seccomp', '?')} "
                    f"NNP={status.get('NoNewPrivs', '?')} "
                    f"USERNS_DIFF={user_ns != container_user_ns}"
                )
                print(record, file=log, flush=True)
                print(record, flush=True)
                if is_renderer:
                    renderer_count += 1

            time.sleep(interval)

    if renderer_count == 0:
        print("FAIL: host-visible Docker process table contained no Chromium renderer", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("container")
    parser.add_argument("output", type=Path)
    parser.add_argument("stop_file", type=Path)
    parser.add_argument("--interval", type=float, default=0.05)
    args = parser.parse_args()
    if args.interval < 0.01 or args.interval > 1:
        parser.error("--interval must be between 0.01 and 1 second")
    return observe(args.container, args.output, args.stop_file, args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
