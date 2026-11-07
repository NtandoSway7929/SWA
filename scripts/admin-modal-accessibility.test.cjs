"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const workspacePath = path.join(
  __dirname,
  "..",
  "admin-dashboard",
  "admin-workspace.js"
);
const source = fs.readFileSync(workspacePath, "utf8");

function loadModalFocusHelpers() {
  const start = source.indexOf("function getModalFocusableElements(modal)");
  const end = source.indexOf("function showModal(", start);
  assert.ok(start >= 0 && end > start,
    "modal focus helpers must appear before showModal()");

  const sandbox = { document: { activeElement: null } };
  vm.runInNewContext(
    source.slice(start, end) +
      "\nthis.getModalFocusableElements = getModalFocusableElements;" +
      "\nthis.handleModalAccessibilityKeydown = handleModalAccessibilityKeydown;",
    sandbox,
    { filename: "admin-workspace-modal-focus-helpers.js" }
  );
  return sandbox;
}

function element(name, documentRef, options = {}) {
  const attributes = Object.assign({}, options.attributes || {});
  return {
    name,
    disabled: options.disabled === true,
    hidden: options.hidden === true,
    getAttribute(attribute) {
      return Object.prototype.hasOwnProperty.call(attributes, attribute)
        ? attributes[attribute]
        : null;
    },
    getClientRects() {
      return options.visible === false ? [] : [{}];
    },
    focus() {
      documentRef.activeElement = this;
    }
  };
}

function modalFixture(elements, dialog) {
  return {
    querySelectorAll() {
      return elements;
    },
    querySelector(selector) {
      return selector === '[role="dialog"]' ? dialog : null;
    },
    contains(target) {
      return elements.includes(target) || target === dialog;
    }
  };
}

function keyboardEvent(key, shiftKey = false) {
  return {
    key,
    shiftKey,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
}

test("focusable-element discovery excludes disabled, hidden and non-rendered controls", () => {
  const helpers = loadModalFocusHelpers();
  const doc = helpers.document;
  const visible = element("visible", doc);
  const disabled = element("disabled", doc, { disabled: true });
  const hidden = element("hidden", doc, { hidden: true });
  const ariaHidden = element("aria-hidden", doc, {
    attributes: { "aria-hidden": "true" }
  });
  const hiddenType = element("hidden-type", doc, {
    attributes: { type: "hidden" }
  });
  const notRendered = element("not-rendered", doc, { visible: false });

  const modal = modalFixture(
    [visible, disabled, hidden, ariaHidden, hiddenType, notRendered],
    element("dialog", doc)
  );

  assert.deepEqual(
    Array.from(helpers.getModalFocusableElements(modal)).map(item => item.name),
    ["visible"]
  );
});

test("Tab and Shift+Tab remain inside the modal and wrap at both ends", () => {
  const helpers = loadModalFocusHelpers();
  const doc = helpers.document;
  const first = element("first", doc);
  const middle = element("middle", doc);
  const last = element("last", doc);
  const dialog = element("dialog", doc);
  const modal = modalFixture([first, middle, last], dialog);

  doc.activeElement = last;
  const forward = keyboardEvent("Tab");
  helpers.handleModalAccessibilityKeydown(forward, modal, () => {});
  assert.equal(doc.activeElement, first);
  assert.equal(forward.defaultPrevented, true);

  doc.activeElement = first;
  const backward = keyboardEvent("Tab", true);
  helpers.handleModalAccessibilityKeydown(backward, modal, () => {});
  assert.equal(doc.activeElement, last);
  assert.equal(backward.defaultPrevented, true);

  doc.activeElement = element("outside", doc);
  const outside = keyboardEvent("Tab");
  helpers.handleModalAccessibilityKeydown(outside, modal, () => {});
  assert.equal(doc.activeElement, first);
  assert.equal(outside.defaultPrevented, true);
});

test("Escape prevents the default action and closes the modal", () => {
  const helpers = loadModalFocusHelpers();
  const modal = modalFixture([], element("dialog", helpers.document));
  let closed = 0;
  const event = keyboardEvent("Escape");

  helpers.handleModalAccessibilityKeydown(event, modal, () => { closed += 1; });

  assert.equal(closed, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("a modal with no focusable controls keeps focus on its dialog container", () => {
  const helpers = loadModalFocusHelpers();
  const dialog = element("dialog", helpers.document);
  const modal = modalFixture([], dialog);
  const event = keyboardEvent("Tab");

  helpers.handleModalAccessibilityKeydown(event, modal, () => {});

  assert.equal(helpers.document.activeElement, dialog);
  assert.equal(event.defaultPrevented, true);
});

test("dynamic form modals expose labels, initial focus, restoration and required controls", () => {
  const start = source.indexOf("function showModal(title, fields, onSubmit)");
  const end = source.indexOf("async function createOrEdit(", start);
  assert.ok(start >= 0 && end > start, "showModal() must be present");
  const showModal = source.slice(start, end);

  assert.match(showModal, /role="dialog" aria-modal="true" aria-labelledby="sway-modal-title" tabindex="-1"/);
  assert.match(showModal, /<h3 id="sway-modal-title">/);
  assert.match(showModal, /document.addEventListener(s*"keydown",s*onModalKeydown,s*true/s);
  assert.match(showModal, /document.removeEventListener(s*"keydown",s*onModalKeydown,s*true/s);
  assert.match(showModal, /firstFormControl[sS]*?initialFocus[sS]*?initialFocus.focus()/);
  assert.match(showModal, /opener.focus()/);
  assert.match(showModal, /close(false)[sS]*?returnFocusTarget.focus()/);
  assert.match(showModal, /disabledAttribute +s*requiredAttribute +s*">" +s*esc(value) +s*"</textarea>"/);
  assert.match(showModal, /disabledAttribute +s*requiredAttribute +s*">" +s*field.options/);
  assert.match(showModal, /submitButton.focus()/);
});
