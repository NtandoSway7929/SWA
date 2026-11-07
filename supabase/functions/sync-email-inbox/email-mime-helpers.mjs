const TEXT_BODY_TYPES = new Set(["text/plain", "text/html"]);

export function sanitizeEmailFilename(value, fallback = "attachment") {
  let name = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/\\\\]/g, "_")
    .replace(/[\\u0000-\\u001f\\u007f]/g, "")
    .replace(/\\.{2,}/g, ".")
    .replace(/^\\.+|\\.+$/g, "")
    .trim();

  if (!name) name = fallback;
  if (name.length > 140) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
    name = name.slice(0, 140 - extension.length) + extension;
  }
  return name;
}

export function normalizeEmailContentId(value) {
  return String(value || "")
    .trim()
    .replace(/^<|>$/g, "")
    .trim()
    .toLowerCase();
}

export function isSafeInlineImageType(value) {
  return /^image\\/(?:jpeg|png|gif|webp|avif)$/i.test(String(value || "").trim());
}

export function collectEmailMimeParts(root) {
  const result = {
    plain: null,
    html: null,
    attachments: [],
  };

  function visit(node) {
    if (!node || typeof node !== "object") return;

    const type = String(node.type || "").toLowerCase();
    const disposition = String(node.disposition || "").toLowerCase();
    const hasChildren = Array.isArray(node.childNodes) && node.childNodes.length > 0;
    const part = String(node.part || "");

    if (TEXT_BODY_TYPES.has(type) && disposition !== "attachment" && part) {
      if (type === "text/plain" && !result.plain) result.plain = node;
      if (type === "text/html" && !result.html) result.html = node;
    } else if (part && !hasChildren && !type.startsWith("multipart/")) {
      const topType = type.split("/")[0];
      const hasName = Boolean(
        node.dispositionParameters?.filename ||
        node.parameters?.name
      );
      const downloadable = disposition === "attachment" ||
        disposition === "inline" ||
        (type && topType !== "text" && topType !== "multipart" && (!disposition || hasName));

      if (downloadable && result.attachments.length < 20) {
        const filename = sanitizeEmailFilename(
          node.dispositionParameters?.filename ||
          node.parameters?.name ||
          "",
          "attachment-" + String(result.attachments.length + 1)
        );
        result.attachments.push({
          part,
          filename,
          contentType: /^[a-z0-9!#$&^_.+-]+\\/[a-z0-9!#$&^_.+-]+$/i.test(type)
            ? type
            : "application/octet-stream",
          sizeBytes: Number.isSafeInteger(Number(node.size)) && Number(node.size) >= 0
            ? Number(node.size)
            : null,
          contentId: normalizeEmailContentId(node.id),
          disposition: disposition || "attachment",
        });
      }
    }

    if (hasChildren) node.childNodes.forEach(visit);
  }

  visit(root);
  return result;
}
