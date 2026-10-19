import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261019030000_innerme_knowledge_acquisition_workflow.sql", "utf8");
const compatibility = readFileSync("supabase/migrations/20261019033000_innerme_knowledge_acquisition_compatibility_hardening.sql", "utf8");
const ui = readFileSync("admin-dashboard/innerme-knowledge-intelligence.js", "utf8");

for (const name of [
  "innerme_knowledge_acquisition_tasks",
  "verify_innerme_acquisition_source",
  "verify_innerme_knowledge_draft",
  "publish_innerme_knowledge_draft",
  "create_innerme_acquisition_task_for_approved_gap"
]) {
  assert.ok(sql.includes(name), "Missing workflow contract: " + name);
}

assert.ok(sql.includes("embedding_status <> 'ready'"), "Publish gate must require ready embeddings.");
assert.ok(sql.includes("v_knowledge.embedding IS NULL"), "Publish gate must require an embedding.");
assert.ok(sql.includes("v_knowledge.status <> 'draft'"), "Draft verification must be limited to draft rows.");
assert.ok(sql.includes("GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge_sources TO authenticated"));
assert.ok(sql.includes("GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge TO authenticated"));

assert.ok(compatibility.includes("CREATE UNIQUE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_gap_id_uidx"), "Each approved gap must map to one task in existing production schemas.");
assert.ok(compatibility.includes("ADD COLUMN IF NOT EXISTS source_verified_by"), "Existing task schemas must retain source-verification identity.");
assert.ok(compatibility.includes("source_verified_by = auth.uid()"), "Source verification must be attributable to an admin.");
assert.ok(compatibility.includes("IF v_source.licence_status = 'unknown' THEN"), "Unknown licence status must block source verification.");
assert.ok(compatibility.includes("v_source.authority_level = 1"), "Review windows must account for source authority.");
assert.ok(compatibility.includes("v_knowledge.embedding_model <> 'gte-small'"), "Publication must require the production embedding model.");
assert.ok(compatibility.includes("v_source.licence_status = 'unknown'"), "Publication must re-check the linked source licence.");

assert.ok(ui.includes("/rest/v1/rpc/verify_innerme_knowledge_draft"), "UI must call the draft-specific verification gate.");
assert.ok(ui.includes("p_acquisition_task_id:id"), "UI must bind verification to its acquisition task.");
assert.ok(!ui.includes('p_verification_method:"acquisition_knowledge_review"'), "UI must not pass an unsupported verification method.");

console.log("InnerMe acquisition governance contract checks passed.");
