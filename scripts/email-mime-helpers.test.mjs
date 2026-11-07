import test from "node:test";
import assert from "node:assert/strict";

import {
  collectEmailMimeParts,
  isSafeInlineImageType,
  normalizeEmailContentId,
  sanitizeEmailFilename,
} from "../supabase/functions/sync-email-inbox/email-mime-helpers.mjs";

test("collects both alternative body parts without classifying them as attachments", () => {
  const result = collectEmailMimeParts({
    type: "multipart/alternative",
    childNodes: [
      { type: "text/plain", part: "1", disposition: null },
      { type: "text/html", part: "2", disposition: null },
    ],
  });
  assert.equal(result.plain.part, "1");
  assert.equal(result.html.part, "2");
  assert.deepEqual(result.attachments, []);
});

test("finds named file attachments and inline image parts recursively", () => {
  const result = collectEmailMimeParts({
    type: "multipart/mixed",
    childNodes: [
      {
        type: "multipart/related",
        childNodes: [
          { type: "text/html", part: "1.1" },
          {
            type: "image/png",
            part: "1.2",
            disposition: "inline",
            dispositionParameters: { filename: "brand-mark.png" },
            id: "<logo@example.test>",
            size: 512,
          },
        ],
      },
      {
        type: "application/pdf",
        part: "2",
        disposition: "attachment",
        dispositionParameters: { filename: "proposal.pdf" },
        size: 4096,
      },
    ],
  });

  assert.equal(result.html.part, "1.1");
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].contentId, "logo@example.test");
  assert.equal(result.attachments[0].disposition, "inline");
  assert.equal(result.attachments[1].filename, "proposal.pdf");
});

test("ignores text attachments as body content and keeps them as downloadable files", () => {
  const result = collectEmailMimeParts({
    type: "multipart/mixed",
    childNodes: [
      { type: "text/plain", part: "1" },
      {
        type: "text/plain",
        part: "2",
        disposition: "attachment",
        dispositionParameters: { filename: "notes.txt" },
      },
    ],
  });
  assert.equal(result.plain.part, "1");
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].filename, "notes.txt");
});

test("sanitizes MIME filenames against path traversal and control characters", () => {
  assert.equal(sanitizeEmailFilename("../../report.pdf"), "report.pdf");
  assert.equal(sanitizeEmailFilename("folder\\\\report.pdf"), "folder_report.pdf");
  assert.equal(sanitizeEmailFilename(""), "attachment");
});

test("normalizes Content-ID headers", () => {
  assert.equal(normalizeEmailContentId(" <Logo@Example.Test> "), "logo@example.test");
});

test("only raster image formats are enabled for inline previews", () => {
  assert.equal(isSafeInlineImageType("image/png"), true);
  assert.equal(isSafeInlineImageType("image/webp"), true);
  assert.equal(isSafeInlineImageType("image/svg+xml"), false);
  assert.equal(isSafeInlineImageType("image/heic"), false);
});
