"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const feature = path.join(root, "business-opportunity-finder");
const source = fs.readFileSync(
    path.join(feature, "business-opportunity-finder.js"),
    "utf8"
);

const registry = {};
let uuidSequence = 0;
const requests = [];

class FakeElement {
    constructor(id) {
        this.id = id || "";
        this.hidden = false;
        this.disabled = false;
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.value = "";
        this.textContent = "";
        this._innerHTML = "";
        this.options = [];
        this.generatedInputs = {};
        this.titleElement = null;
        this.focused = false;
        this.fields = {};
    }

    addEventListener(type, callback) {
        this.listeners[type] = callback;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    focus() {
        this.focused = true;
    }

    scrollIntoView() {}
    remove() {
        if (this.id) delete registry[this.id];
        this.removed = true;
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.options = [];
        this.generatedInputs = {};
        this.titleElement = null;

        if (this.id === "bof-step-content") {
            const titleMatch = this._innerHTML.match(
                /<h3 class="bof-step-title" tabindex="-1">([\s\S]*?)<\/h3>/
            );
            if (titleMatch) {
                this.titleElement = new FakeElement("bof-step-title");
                this.titleElement.textContent = titleMatch[1];
            }

            const optionPattern =
                /<button class="bof-option" type="button" data-mode="([^"]+)" data-select-option="([^"]+)" aria-pressed="([^"]+)">([\s\S]*?)<\/button>/g;
            let optionMatch;
            while ((optionMatch = optionPattern.exec(this._innerHTML)) !== null) {
                const option = new FakeElement("bof-option");
                option.dataset.mode = optionMatch[1];
                option.dataset.selectOption = optionMatch[2];
                option.attributes["aria-pressed"] = optionMatch[3];
                option.closest = (selector) =>
                    selector === "[data-select-option]" ? option : null;
                this.options.push(option);
            }

            const inputPattern = /<input\b[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/g;
            let inputMatch;
            while ((inputMatch = inputPattern.exec(this._innerHTML)) !== null) {
                const input = new FakeElement(inputMatch[1]);
                input.value = inputMatch[2];
                this.generatedInputs[input.id] = input;
                registry[input.id] = input;
            }
        }

        if (this.id === "bof-report-footer-actions") {
            const idPattern = /id="([^"]+)"/g;
            let match;
            while ((match = idPattern.exec(this._innerHTML)) !== null) {
                const node = new FakeElement(match[1]);
                registry[node.id] = node;
            }
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    querySelectorAll(selector) {
        if (selector === "[data-select-option]") return this.options;
        if (selector === "input, select, textarea, button") {
            return Object.values(this.fields);
        }
        return [];
    }

    querySelector(selector) {
        if (selector === ".bof-step-title") return this.titleElement;
        if (selector === '[name="name"]') return this.fields.name || null;
        return null;
    }

    insertAdjacentHTML(position, html) {
        const ids = [...String(html).matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
        ids.forEach((id) => {
            registry[id] = new FakeElement(id);
        });

        const panel = registry["bof-contact-panel"];
        const form = registry["bof-contact-form"];
        if (panel) panel.hidden = true;
        if (form) {
            form.fields = {
                name: new FakeElement("contact-name"),
                email: new FakeElement("contact-email"),
                phone: new FakeElement("contact-phone"),
                preferred_contact_method: new FakeElement("contact-preferred"),
                message: new FakeElement("contact-message"),
                notice_accepted: new FakeElement("contact-consent"),
                website: new FakeElement("contact-website")
            };
            form.fields.preferred_contact_method.value = "email";
            form.querySelectorAll = (query) =>
                query === "input, select, textarea, button"
                    ? Object.values(form.fields)
                    : [];
            form.querySelector = () => null;
        }
    }
}

const ids = [
    "bof-intro",
    "bof-assessment",
    "bof-report",
    "bof-step-content",
    "bof-step-error",
    "bof-back",
    "bof-continue",
    "bof-progress",
    "bof-progress-fill",
    "bof-progress-label",
    "bof-progress-percent",
    "bof-report-content",
    "bof-copy-report",
    "bof-restart"
];

const elements = Object.fromEntries(ids.map((id) => {
    const node = new FakeElement(id);
    registry[id] = node;
    return [id, node];
}));

const startButton = new FakeElement("bof-start");
const actions = new FakeElement("bof-report-footer-actions");
const disclaimer = new FakeElement("bof-preview-disclaimer");
const reportSection = elements["bof-report"];
reportSection.querySelector = (selector) => {
    if (selector === ".bof-report-footer-actions") return actions;
    if (selector === ".bof-preview-disclaimer") return disclaimer;
    if (selector === "#bof-contact-panel") return registry["bof-contact-panel"] || null;
    return null;
};
reportSection.insertAdjacentHTML = FakeElement.prototype.insertAdjacentHTML;

const document = {
    getElementById(id) {
        return registry[id] ||
            elements["bof-step-content"].generatedInputs[id] ||
            null;
    },
    querySelectorAll(selector) {
        return selector === "[data-bof-start]" ? [startButton] : [];
    },
    createElement() {
        return new FakeElement("temporary");
    },
    body: {
        appendChild() {},
    },
    execCommand() { return true; }
};

const window = {
    scrollTo() {},
    setTimeout(callback) { callback(); },
    crypto: {
        randomUUID() {
            uuidSequence += 1;
            return "00000000-0000-4000-8000-" + String(uuidSequence).padStart(12, "0");
        },
        getRandomValues(bytes) { return bytes; }
    }
};

class FakeFormData {
    constructor(form) {
        this.form = form;
    }
    get(name) {
        const field = this.form.fields[name];
        if (!field) return null;
        if (name === "notice_accepted") return field.checked ? "on" : null;
        return field.value;
    }
}

async function fakeFetch(url, options) {
    const payload = JSON.parse(options.body);
    requests.push({ url, payload, options });

    if (payload.action === "complete_assessment") {
        const rules = await import("../supabase/functions/submit-business-assessment/rules.mjs");
        const normalized = rules.normalizeAssessmentPayload(payload);
        const report = rules.buildBusinessOpportunityReport(
            normalized.businessProfile,
            normalized.answers
        );
        return {
            ok: true,
            status: 201,
            headers: { get() { return null; } },
            async json() {
                return {
                    ok: true,
                    assessment_id: "11111111-1111-4111-8111-111111111111",
                    report,
                    idempotent_replay: false
                };
            }
        };
    }

    if (payload.action === "request_contact") {
        return {
            ok: true,
            status: 200,
            headers: { get() { return null; } },
            async json() {
                return {
                    ok: true,
                    contact_requested: true,
                    enquiry_reference: "22222222-2222-4222-8222-222222222222"
                };
            }
        };
    }

    throw new Error("Unexpected request action: " + payload.action);
}

vm.runInNewContext(source, {
    document,
    window,
    console,
    navigator: { clipboard: { async writeText() {} } },
    fetch: fakeFetch,
    FormData: FakeFormData,
    Uint8Array,
    setTimeout,
    clearTimeout
});

function click(element) {
    assert.ok(element.listeners.click, "Expected click handler on " + element.id);
    return element.listeners.click({ target: element, currentTarget: element });
}

function choose(value) {
    const content = elements["bof-step-content"];
    const option = content.options.find((item) => item.dataset.selectOption === value);
    assert.ok(option, "Expected visible option: " + value);
    assert.ok(option.closest("[data-select-option]"), "Option must support delegated selection");
    return content.listeners.click({ target: option });
}

function next() {
    return click(elements["bof-continue"]);
}

async function completeAssessment({ discovery, contact, friction, priority, businessName }) {
    await click(startButton);
    assert.equal(elements["bof-intro"].hidden, true);
    assert.equal(elements["bof-assessment"].hidden, false);
    assert.equal(elements["bof-step-content"].titleElement.focused, true,
        "The first question heading should receive managed focus");

    choose("beauty_personal_care");
    if (businessName) {
        const input = document.getElementById("bof-business-name");
        assert.ok(input, "Business name input should be present");
        input.value = businessName;
        input.listeners.input();
    }

    await next();
    discovery.forEach(choose);
    await next();
    choose(contact);
    await next();
    friction.forEach(choose);
    await next();
    choose(priority);
    await next();

    assert.equal(elements["bof-assessment"].hidden, true);
    assert.equal(elements["bof-report"].hidden, false);
    return elements["bof-report-content"].innerHTML;
}

(async () => {
    // The first completed assessment is submitted once and the server report is rendered.
    const firstReport = await completeAssessment({
        discovery: ["instagram", "facebook", "google_business"],
        contact: "whatsapp",
        friction: ["missed_followups"],
        priority: "responses",
        businessName: "Studio Example"
    });
    assert.match(firstReport, /Studio Example/);
    assert.match(firstReport, /Instagram/);
    assert.match(firstReport, /Facebook/);
    assert.match(firstReport, /Google Business Profile/);
    assert.match(firstReport, /Website: Not established from your answers/);
    assert.match(firstReport, /Self-reported/);
    assert.match(firstReport, /AI Customer Reply Setup/);
    assert.doesNotMatch(firstReport, /Website Design &amp; Development/);

    const assessmentRequest = requests.find((request) => request.payload.action === "complete_assessment");
    assert.ok(assessmentRequest, "The assessment must be submitted to the backend");
    assert.equal(assessmentRequest.payload.assessment_version, "bof-2026-11-v1");
    assert.equal(assessmentRequest.payload.responses.length, 5);
    assert.equal("findings" in assessmentRequest.payload, false,
        "The browser must not send trusted findings to the server");
    assert.equal("recommendations" in assessmentRequest.payload, false,
        "The browser must not send trusted service recommendations to the server");

    // Contact details remain hidden until the user explicitly opens the post-report form.
    const contactPanel = registry["bof-contact-panel"];
    const openContactButton = registry["bof-open-contact"];
    assert.ok(contactPanel && contactPanel.hidden, "The contact form must be hidden after report creation");
    await click(openContactButton);
    assert.equal(contactPanel.hidden, false, "The contact form should open only after the report");

    const contactForm = registry["bof-contact-form"];
    contactForm.fields.name.value = "Business Owner";
    contactForm.fields.email.value = "owner@example.com";
    contactForm.fields.phone.value = "";
    contactForm.fields.preferred_contact_method.value = "email";
    contactForm.fields.message.value = "Please contact me about the findings.";
    contactForm.fields.notice_accepted.checked = true;
    await contactForm.listeners.submit({ preventDefault() {}, currentTarget: contactForm });

    const contactRequest = requests.find((request) => request.payload.action === "request_contact");
    assert.ok(contactRequest, "The contact form must submit only after explicit request");
    assert.equal(contactRequest.payload.assessment_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(contactRequest.payload.contact_request.notice_accepted, true);
    assert.equal(contactRequest.payload.contact_request.notice_version, "bof-contact-v1");
    assert.match(registry["bof-contact-status"].textContent, /contact request has been received/i);

    // Restarting creates a fresh assessment session for the next business.
    await click(registry["bof-restart"]);
    assert.equal(elements["bof-intro"].hidden, false);
    assert.equal(elements["bof-report"].hidden, true);

    console.log("Business Opportunity Finder live submission and contact flow tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
