const SAFE_TAGS = new Set([
  "p", "div", "br", "strong", "b", "em", "i", "u", "s", "strike",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "span", "a",
]);
const BLOCKED_TAGS = ["script", "style", "iframe", "object", "embed", "svg", "math", "form", "button", "input", "textarea", "select", "video", "audio"];
const SAFE_FONTS = new Set([
  "arial", "aptos", "calibri", "cambria", "georgia", "helvetica",
  "montserrat", "raleway", "tahoma", "times new roman",
  "trebuchet ms", "verdana", "courier new", "sans-serif", "serif", "monospace",
]);

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(code, 16))));
}

function safeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ||
    /^(black|white|red|blue|green|navy|gray|grey|orange|yellow)$/i.test(color) ? color : "";
}

function cleanStyle(value) {
  const safe = [];
  for (const declaration of String(value || "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const setting = declaration.slice(colon + 1).trim();
    if (!setting || /url\s*\(|expression\s*\(|[{}<>\\]/i.test(setting)) continue;
    if (property === "font-family") {
      const families = setting.split(",").map((font) => font.trim().replace(/^['"]|['"]$/g, ""));
      if (families.length && families.every((font) => SAFE_FONTS.has(font.toLowerCase()))) safe.push("font-family:" + families.join(", "));
    } else if (property === "font-size" && /^\d{1,2}(?:\.\d+)?(px|pt)$/i.test(setting)) {
      const size = Number.parseFloat(setting);
      if (size >= 9 && size <= 40) safe.push("font-size:" + setting);
    } else if (property === "color" || property === "background-color") {
      const color = safeColor(setting);
      if (color) safe.push(property + ":" + color);
    } else if (property === "font-weight" && /^(normal|bold|[4-8]00)$/i.test(setting)) {
      safe.push("font-weight:" + setting);
    } else if (property === "font-style" && /^(normal|italic)$/i.test(setting)) {
      safe.push("font-style:" + setting);
    } else if (property === "text-decoration" && /^(none|underline|line-through)$/i.test(setting)) {
      safe.push("text-decoration:" + setting);
    } else if (property === "text-align" && /^(left|center|right|justify)$/i.test(setting)) {
      safe.push("text-align:" + setting);
    }
  }
  return safe.join(";");
}

function safeHref(value) {
  const href = decodeEntities(value).trim();
  if (!href || /[\u0000-\u0020\u007f]/.test(href)) return "";
  try {
    const parsed = new URL(href);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

export function looksLikeRichEmailHtml(value) {
  return /<\s*(p|div|br|strong|b|em|i|u|s|ul|ol|li|h[1-4]|blockquote|span|a)\b[^>]*>/i.test(String(value || ""));
}

export function sanitizeEmailRichHtml(value) {
  let html = String(value || "").slice(0, 60000).replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of BLOCKED_TAGS) {
    const blocked = new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?<\\/" + tag + "\\s*>", "gi");
    html = html.replace(blocked, "");
  }
  html = html.replace(/<(script|style|iframe|object|embed|svg|math|form|button|input|textarea|select|video|audio)\b[^>]*\/?>/gi, "");
  return html.replace(/<\/?([a-z][a-z0-9]*)\b([^<>]*)>/gi, (match, rawTag, rawAttributes) => {
    const tag = String(rawTag).toLowerCase();
    const closing = /^<\s*\//.test(match);
    if (!SAFE_TAGS.has(tag)) return "";
    if (closing) return tag === "br" ? "" : "</" + tag + ">";
    if (tag === "br") return "<br>";
    let style = "";
    let href = "";
    const attributePattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<> \x60]+))/g;
    for (const attribute of String(rawAttributes || "").matchAll(attributePattern)) {
      const name = String(attribute[1] || "").toLowerCase();
      const quoted = attribute[3] !== undefined ? attribute[3] : attribute[4];
      const setting = quoted !== undefined ? quoted : (attribute[5] || "");
      if (name === "style") style = cleanStyle(setting);
      if (tag === "a" && name === "href") href = safeHref(setting);
    }
    const attributes = [];
    if (style) attributes.push('style="' + style.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"');
    if (tag === "a" && href) {
      attributes.push('href="' + href.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"');
      attributes.push('target="_blank"', 'rel="noopener noreferrer"');
    }
    return "<" + tag + (attributes.length ? " " + attributes.join(" ") : "") + ">";
  });
}

export function richHtmlToPlainText(value) {
  const safe = sanitizeEmailRichHtml(value);
  return decodeEntities(
    safe
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(?:p|div|li|h[1-4]|blockquote|ul|ol)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}