import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sendEmailSource = readFileSync(
  new URL("../supabase/functions/send-email/index.ts", import.meta.url),
  "utf8",
);

test("sent email records retain the same branded HTML sent to Resend", () => {
  assert.ok(sendEmailSource.includes("const htmlBody = brandedEmailHtml("));
  assert.ok(sendEmailSource.includes("html: htmlBody,"));
  assert.ok(sendEmailSource.includes("html_body:\n            dashboardPreviewHtml,"));
  assert.ok(!sendEmailSource.includes("html_body:\n            null,"));
});

test("dashboard email previews embed the Swayphics logo and proposal media", () => {
  assert.ok(sendEmailSource.includes("async function emailImageDataUri(url: string)"));
  assert.ok(sendEmailSource.includes("async function buildDashboardEmailPreview("));
  assert.ok(sendEmailSource.includes('source: \'src="https://swayphics.co.za/swayphics-logo.png"\''));
  assert.ok(sendEmailSource.includes('src="cid:swayphics-improvement-website"'));
  assert.ok(sendEmailSource.includes('src="cid:swayphics-no-website"'));
  assert.ok(sendEmailSource.includes('return "data:" + contentType + ";base64,";'));
});

test("preview-only image failures do not block sending the actual email", () => {
  assert.ok(sendEmailSource.includes("Keep sending even if a preview-only image cannot be embedded."));
  assert.ok(sendEmailSource.includes("console.warn(\"Unable to embed a Swayphics email preview image:\""));
});
