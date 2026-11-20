import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [push, innerMe, knowledgeEmbed] = await Promise.all([
  read("supabase/functions/send-admin-push/index.ts"),
  read("supabase/functions/swayphics-ai/index.ts"),
  read("supabase/functions/innerme-knowledge-embed/index.ts"),
]);

test("admin push uses only its explicitly named rotation key", () => {
  assert.match(push, /PUSH_SECRET_KEY_NAME\s*=\s*["']swayphics-admin-push-rotation["']/);
  assert.match(push, /secretKeys\[PUSH_SECRET_KEY_NAME\]/);
  assert.match(push, /apiKey\s*!==\s*backendApiKey/);
  assert.doesNotMatch(push, /Object\.values\(secretKeys\)/);
  assert.doesNotMatch(push, /serviceRoleKey/);
  assert.doesNotMatch(push, /Authorization:\s*["']Bearer\s*["']\s*\+\s*backendApiKey/);
});

test("InnerMe no longer reads the ambiguous singular secret-key variable", () => {
  assert.doesNotMatch(innerMe, /Deno\.env\.get\(["']SUPABASE_SECRET_KEY["']\)/);
  assert.match(innerMe, /Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/);
});

test("knowledge embedding uses the separate legacy service-role JWT", () => {
  assert.doesNotMatch(knowledgeEmbed, /SUPABASE_SECRET_KEYS/);
  assert.match(knowledgeEmbed, /Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/);
  assert.match(knowledgeEmbed, /Authorization:\s*["']Bearer\s*["']\s*\+\s*secretKey/);
  assert.doesNotMatch(knowledgeEmbed, /secretKeys\.default/);
  assert.equal((knowledgeEmbed.match(/\{ headers: adminHeaders \}/g) || []).length, 2);
  assert.equal((knowledgeEmbed.match(/\.\.\.adminHeaders/g) || []).length, 2);
});
