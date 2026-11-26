import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeRichEmailHtml,
  richHtmlToPlainText,
  sanitizeEmailRichHtml,
} from "../supabase/functions/send-email/rich-text-helpers.mjs";

test("recognises formatted editor content while leaving ordinary text alone", () => {
  assert.equal(looksLikeRichEmailHtml("<p><strong>Hello</strong></p>"), true);
  assert.equal(looksLikeRichEmailHtml("Hello < customer"), false);
});

test("preserves approved formatting and removes executable or unsupported markup", () => {
  const safe = sanitizeEmailRichHtml(
    '<p style="font-family:Arial;font-size:18px;color:#123456" onclick="alert(1)">Hello <strong>there</strong><script>alert(2)</script></p>' +
    '<img src=x onerror="alert(3)"><iframe src="https://bad.example"></iframe>'
  );
  assert.match(safe, /<strong>there<\/strong>/);
  assert.match(safe, /font-size:18px/);
  assert.doesNotMatch(safe, /onclick|script|iframe|img|onerror/i);
});

test("rejects unsafe hyperlink protocols and retains safe HTTPS links", () => {
  const safe = sanitizeEmailRichHtml(
    '<p><a href="javascript:alert(1)">unsafe</a> <a href="https://example.com/path">safe</a></p>'
  );
  assert.doesNotMatch(safe, /javascript:/i);
  assert.match(safe, /href="https:\/\/example\.com\/path"/);
});

test("converts formatted email content into readable plain text for CRM history", () => {
  assert.equal(
    richHtmlToPlainText("<p>First <strong>point</strong></p><ul><li>One</li><li>Two</li></ul>"),
    "First point\n• One\n• Two"
  );
});
