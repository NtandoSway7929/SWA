#!/usr/bin/env python3
"""Parse Yoco migration and SQL test files with PostgreSQL's SQL grammar.

This is syntax-only validation. It does not resolve schema dependencies, compile
PL/pgSQL bodies, execute statements, or replace disposable-database tests.
"""
from pathlib import Path
import sys

from pglast import parse_sql


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*_yoco_*.sql")) + sorted((ROOT / "supabase" / "migrations").glob("*_paystack_*.sql")) + sorted((ROOT / "supabase" / "migrations").glob("*_bank_transfer_*.sql"))
TESTS = sorted((ROOT / "supabase" / "tests").glob("*yoco*.sql")) + sorted((ROOT / "supabase" / "tests").glob("*paystack*.sql")) + sorted((ROOT / "supabase" / "tests").glob("*bank_transfer*.sql"))


def main() -> int:
    files = MIGRATIONS + TESTS
    if not MIGRATIONS:
        print("No payment migration files found.", file=sys.stderr)
        return 1
    if not TESTS:
        print("No payment SQL test files found.", file=sys.stderr)
        return 1

    failures = []
    for path in files:
        source = path.read_text(encoding="utf-8")
        try:
            statements = parse_sql(source)
        except Exception as exc:  # pglast exposes parser-specific exceptions
            failures.append((path, str(exc)))
            print(f"FAIL {path.relative_to(ROOT)}: {exc}")
            continue
        print(f"PASS {path.relative_to(ROOT)}: {len(statements)} statements")

    print(
        f"\nPostgreSQL grammar result: {len(files) - len(failures)}/{len(files)} files parsed."
    )
    if failures:
        return 1
    print(
        "LIMITATION: parser success does not validate referenced tables, functions, "
        "PL/pgSQL execution, grants, RLS, transaction behavior, or concurrency."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
