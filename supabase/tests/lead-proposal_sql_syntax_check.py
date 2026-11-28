from pathlib import Path
from pglast import parse_sql

files = [
    Path("supabase/migrations/20261128090000_lead_proposal_revision_history.sql"),
    Path("supabase/tests/lead-proposal-revisions-baseline.sql"),
    Path("supabase/tests/lead-proposal-revisions.test.sql"),
]
for path in files:
    parse_sql(path.read_text(encoding="utf-8"))
    print(f"PostgreSQL syntax OK: {path}")
