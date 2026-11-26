(function () {
  "use strict";

  const TAGS = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "SPAN", "A"]);
  const BLOCKED = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"]);
  const FONTS = ["Arial", "Aptos", "Calibri", "Cambria", "Georgia", "Helvetica", "Montserrat", "Raleway", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana", "Courier New"];
  const mounted = new WeakMap();

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
    });
  }

  function safeLink(value) {
    const href = String(value || "").trim();
    if (!href || /[\u0000-\u0020\u007f]/.test(href)) return "";
    try {
      const parsed = new URL(href, window.location.origin);
      return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
    } catch (_) {
      return "";
    }
  }

  function safeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ||
      /^(black|white|red|blue|green|navy|gray|grey|orange|yellow)$/i.test(color) ? color : "";
  }

  function cleanStyle(value) {
    const safe = [];
    String(value || "").split(";").forEach(function (declaration) {
      const colon = declaration.indexOf(":");
      if (colon < 1) return;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const setting = declaration.slice(colon + 1).trim();
      if (!setting || /url\s*\(|expression\s*\(|[{}<>\\]/i.test(setting)) return;

      if (property === "font-family") {
        const families = setting.split(",").map(function (font) {
          return font.trim().replace(/^['"]|['"]$/g, "");
        });
        if (families.length && families.every(function (font) {
          return FONTS.some(function (allowed) { return allowed.toLowerCase() === font.toLowerCase(); }) ||
            /^(sans-serif|serif|monospace)$/i.test(font);
        })) safe.push("font-family:" + families.join(", "));
      } else if (property === "font-size" && /^\d{1,2}(?:\.\d+)?(px|pt)$/i.test(setting)) {
        const size = parseFloat(setting);
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
    });
    return safe.join(";");
  }

  function sanitizeHTML(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");

    function clean(parent) {
      Array.from(parent.childNodes).forEach(function (node) {
        if (node.nodeType === 8) {
          node.remove();
          return;
        }
        if (node.nodeType !== 1) return;

        const tag = node.tagName;
        if (BLOCKED.has(tag)) {
          node.remove();
          return;
        }
        clean(node);
        if (!TAGS.has(tag)) {
          node.replaceWith.apply(node, Array.from(node.childNodes));
          return;
        }

        const style = cleanStyle(node.getAttribute("style"));
        const href = tag === "A" ? safeLink(node.getAttribute("href")) : "";
        const taskClass = tag === "UL" && node.classList.contains("sway-rich-checklist")
          ? "sway-rich-checklist" : "";
        Array.from(node.attributes).forEach(function (attribute) { node.removeAttribute(attribute.name); });
        if (style) node.setAttribute("style", style);
        if (taskClass) node.setAttribute("class", taskClass);
        if (href) {
          node.setAttribute("href", href);
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  function plainTextFromHTML(value) {
    const template = document.createElement("template");
    const safe = sanitizeHTML(value)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(?:p|div|li|h[1-4]|blockquote|ul|ol)>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    template.innerHTML = safe;
    const text = String(template.content.textContent || "").replace(/\u00a0/g, " ");
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function plainTextToHTML(value) {
    const text = String(value || "");
    if (!text.trim()) return "";
    return text.split(/\n{2,}/).map(function (paragraph) {
      return "<p>" + escapeHTML(paragraph).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  function button(label, command, title) {
    return '<button type="button" class="sway-rich-tool-button" data-rich-command="' +
      escapeHTML(command) + '" title="' + escapeHTML(title || label) + '" aria-label="' +
      escapeHTML(title || label) + '">' + label + "</button>";
  }

  function toolbarMarkup() {
    return '<div class="sway-rich-toolbar" role="toolbar" aria-label="Text formatting">' +
      '<div class="sway-rich-tool-group">' +
        button("<strong>B</strong>", "bold", "Bold") +
        button("<em>I</em>", "italic", "Italic") +
        button("<u>U</u>", "underline", "Underline") +
        button("<s>S</s>", "strikeThrough", "Strikethrough") +
      "</div><span class=\"sway-rich-tool-divider\" aria-hidden=\"true\"></span>" +
      '<div class="sway-rich-tool-group sway-rich-select-group">' +
        '<label class="sway-rich-control-label">Style<select data-rich-block aria-label="Paragraph style">' +
          '<option value="P">Normal</option><option value="H1">Title</option><option value="H2">Heading</option><option value="H3">Subheading</option><option value="BLOCKQUOTE">Quote</option>' +
        "</select></label>" +
        '<label class="sway-rich-control-label">Font<select data-rich-font aria-label="Font family"><option value="">Default</option>' +
          FONTS.map(function (font) { return '<option value="' + escapeHTML(font) + '">' + escapeHTML(font) + "</option>"; }).join("") +
        "</select></label>" +
        '<label class="sway-rich-control-label">Size<select data-rich-size aria-label="Font size">' +
          [12, 14, 16, 18, 20, 24, 28, 32].map(function (size) {
            return '<option value="' + size + '"' + (size === 14 ? " selected" : "") + ">" + size + "</option>";
          }).join("") +
        "</select></label>" +
      "</div><span class=\"sway-rich-tool-divider\" aria-hidden=\"true\"></span>" +
      '<div class="sway-rich-tool-group">' +
        '<label class="sway-rich-colour-control" title="Text colour">A<input type="color" data-rich-color value="#24324A" aria-label="Text colour"></label>' +
        '<label class="sway-rich-colour-control sway-rich-highlight-control" title="Highlight colour">▰<input type="color" data-rich-highlight value="#FFF2A8" aria-label="Highlight colour"></label>' +
      "</div><span class=\"sway-rich-tool-divider\" aria-hidden=\"true\"></span>" +
      '<div class="sway-rich-tool-group">' +
        button("• List", "insertUnorderedList", "Bullet list") +
        button("1. List", "insertOrderedList", "Numbered list") +
        button("☐ Tasks", "checklist", "Checklist") +
        button("↗ Link", "createLink", "Insert link") +
      "</div><span class=\"sway-rich-tool-divider\" aria-hidden=\"true\"></span>" +
      '<div class="sway-rich-tool-group">' +
        button("↤", "justifyLeft", "Align left") +
        button("↔", "justifyCenter", "Align centre") +
        button("↦", "justifyRight", "Align right") +
        button("Tx", "removeFormat", "Clear formatting") +
        button("↶", "undo", "Undo") +
        button("↷", "redo", "Redo") +
      "</div></div>";
  }

  function closestTag(node, tagName, root) {
    let element = node && (node.nodeType === 1 ? node : node.parentElement);
    while (element && element !== root) {
      if (element.tagName === tagName) return element;
      element = element.parentElement;
    }
    return null;
  }

  function replaceFontTags(root) {
    root.querySelectorAll("font").forEach(function (font) {
      const span = document.createElement("span");
      const face = font.getAttribute("face");
      const size = font.getAttribute("size");
      const color = safeColor(font.getAttribute("color"));
      if (face && FONTS.some(function (item) { return item.toLowerCase() === face.toLowerCase(); })) {
        span.style.fontFamily = face;
      }
      if (color) span.style.color = color;
      const mapped = { "1": 10, "2": 12, "3": 14, "4": 16, "5": 18, "6": 24, "7": 32 }[size];
      if (mapped) span.style.fontSize = mapped + "px";
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
  }

  function mount(source, options) {
    if (!source || mounted.has(source)) return mounted.get(source) || null;
    options = options || {};

    const root = document.createElement("div");
    root.className = "sway-rich-editor sway-rich-editor-" + (options.variant || "default");
    root.setAttribute("data-sway-rich-editor", options.variant || "default");

    const toolbar = document.createElement("div");
    toolbar.innerHTML = toolbarMarkup();
    const actualToolbar = toolbar.firstElementChild;
    const surface = document.createElement("div");
    surface.className = "sway-rich-surface";
    surface.contentEditable = "true";
    surface.setAttribute("role", "textbox");
    surface.setAttribute("aria-multiline", "true");
    surface.setAttribute("aria-label", options.ariaLabel || source.getAttribute("aria-label") || "Rich text editor");
    surface.setAttribute("data-placeholder", options.placeholder || source.getAttribute("placeholder") || "Start writing...");
    surface.spellcheck = true;

    root.appendChild(actualToolbar);
    root.appendChild(surface);
    source.parentNode.insertBefore(root, source);
    source.classList.add("sway-rich-source");
    source.setAttribute("aria-hidden", "true");
    source.setAttribute("tabindex", "-1");
    source.required = false;
    source.removeAttribute("maxlength");

    let lastRange = null;
    let silent = false;

    function rememberSelection() {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (surface.contains(range.commonAncestorContainer)) lastRange = range.cloneRange();
    }

    function restoreSelection() {
      surface.focus();
      if (!lastRange) return;
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      try { selection.addRange(lastRange); } catch (_) { lastRange = null; }
    }

    function syncSource() {
      if (silent) return;
      replaceFontTags(surface);
      const html = sanitizeHTML(surface.innerHTML);
      const text = String(surface.innerText || surface.textContent || "").replace(/\u00a0/g, " ").trim();
      source.value = text ? html : "";
      source.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function runCommand(command, value) {
      restoreSelection();
      if (command === "checklist") {
        document.execCommand("insertHTML", false,
          '<ul class="sway-rich-checklist"><li>☐ </li></ul><p><br></p>');
      } else if (command === "createLink") {
        const href = safeLink(window.prompt("Enter a web or email link:"));
        if (href) document.execCommand("createLink", false, href);
      } else if (command === "fontName") {
        document.execCommand("fontName", false, value);
        replaceFontTags(surface);
      } else if (command === "fontSize") {
        document.execCommand("fontSize", false, "7");
        surface.querySelectorAll('font[size="7"]').forEach(function (font) {
          const span = document.createElement("span");
          span.style.fontSize = value + "px";
          while (font.firstChild) span.appendChild(font.firstChild);
          font.replaceWith(span);
        });
        replaceFontTags(surface);
      } else {
        document.execCommand(command, false, value == null ? null : value);
        replaceFontTags(surface);
      }
      rememberSelection();
      syncSource();
    }

    actualToolbar.addEventListener("mousedown", function (event) {
      rememberSelection();
      if (event.target.closest("button")) event.preventDefault();
    });
    actualToolbar.addEventListener("click", function (event) {
      const control = event.target.closest("[data-rich-command]");
      if (control) runCommand(control.getAttribute("data-rich-command"));
    });
    actualToolbar.querySelector("[data-rich-block]").addEventListener("change", function (event) {
      runCommand("formatBlock", "<" + event.target.value.toLowerCase() + ">");
    });
    actualToolbar.querySelector("[data-rich-font]").addEventListener("change", function (event) {
      if (event.target.value) runCommand("fontName", event.target.value);
      event.target.value = "";
    });
    actualToolbar.querySelector("[data-rich-size]").addEventListener("change", function (event) {
      runCommand("fontSize", event.target.value);
    });
    actualToolbar.querySelector("[data-rich-color]").addEventListener("input", function (event) {
      runCommand("foreColor", event.target.value);
    });
    actualToolbar.querySelector("[data-rich-highlight]").addEventListener("input", function (event) {
      runCommand("hiliteColor", event.target.value);
    });

    surface.addEventListener("paste", function (event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      event.preventDefault();
      const pastedHTML = clipboard.getData("text/html");
      const pastedText = clipboard.getData("text/plain");
      if (pastedHTML) {
        document.execCommand("insertHTML", false, sanitizeHTML(pastedHTML));
      } else {
        document.execCommand("insertText", false, pastedText);
      }
      syncSource();
    });
    surface.addEventListener("input", syncSource);
    surface.addEventListener("keyup", rememberSelection);
    surface.addEventListener("mouseup", rememberSelection);
    surface.addEventListener("focus", rememberSelection);
    surface.addEventListener("click", function (event) {
      const item = event.target.closest("li");
      if (!item || !item.parentElement || !item.parentElement.classList.contains("sway-rich-checklist")) return;
      const selection = window.getSelection();
      if (selection && selection.isCollapsed && event.target === item) {
        item.firstChild && item.firstChild.nodeType === 3 && (item.firstChild.nodeValue =
          item.firstChild.nodeValue.replace(/^[☐☑]/, function (mark) { return mark === "☐" ? "☑" : "☐"; }));
        syncSource();
      }
    });
    surface.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        const form = source.closest("form");
        if (form) { event.preventDefault(); form.requestSubmit(); }
      }
    });
    const editor = {
      root: root,
      toolbar: actualToolbar,
      surface: surface,
      getHTML: function () { replaceFontTags(surface); return sanitizeHTML(surface.innerHTML); },
      getText: function () { return String(surface.innerText || surface.textContent || "").replace(/\u00a0/g, " ").trim(); },
      setHTML: function (html) {
        silent = true;
        surface.innerHTML = sanitizeHTML(html);
        source.value = editor.getText() ? editor.getHTML() : "";
        silent = false;
      },
      setText: function (text) { editor.setHTML(plainTextToHTML(text)); },
      focus: function () { surface.focus(); }
    };

    mounted.set(source, editor);
    source.__swayRichEditor = editor;
    if (options.initialHTML) editor.setHTML(options.initialHTML);
    else if (source.value) editor.setText(source.value);
    return editor;
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    const targets = [];
    if (root.matches && root.matches("#sway-email-message")) targets.push(root);
    targets.push.apply(targets, Array.from(root.querySelectorAll("#sway-email-message")));
    targets.forEach(function (textarea) {
      if (!textarea.__swayRichEditor) mount(textarea, {
        variant: "email",
        placeholder: "Write your message. Use headings, lists, checklists and text styling.",
        ariaLabel: "Email message"
      });
    });
  }

  window.swayphicsRichText = {
    mount: mount,
    sanitizeHTML: sanitizeHTML,
    toText: function (value) {
      return /<\s*(p|div|br|strong|b|em|i|u|s|ul|ol|li|h[1-4]|blockquote|span|a)\b/i.test(String(value || ""))
        ? plainTextFromHTML(value) : String(value || "");
    },
    plainTextToHTML: plainTextToHTML
  };

  function boot() {
    scan(document);
    if (typeof MutationObserver !== "undefined" && document.documentElement) {
      const observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) scan(node);
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();