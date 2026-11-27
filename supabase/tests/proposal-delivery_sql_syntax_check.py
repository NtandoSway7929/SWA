from pathlib import Path
from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[2]
FILES = [
    "supabase/tests/proposal-review-baseline.sql",
    "supabase/migrations/20261128090000_lead_proposal_revision_history.sql",
    "supabase/migrations/20261128100000_swayphics_quote_pricing_engine.sql",
    "supabase/migrations/20261128110000_swayphics_proposal_delivery_acceptance.sql",
    "supabase/tests/proposal-review-workflow.test.sql",
]

for relative in FILES:
    source = (ROOT / relative).read_text(encoding="utf-8")
    parse_sql(source)
    print(f"PostgreSQL syntax OK: {relative}")
