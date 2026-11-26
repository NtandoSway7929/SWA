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

class FakeElement {
    constructor(id) {
        this.id = id || "";
        this.hidden = false;
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
    }

    addEventListener(type, callback) {
        this.listeners[type] = callback;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    focus() {
        this.focused = true;
    }

    scrollIntoView() {}

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.options = [];
        this.generatedInputs = {};
        this.titleElement = null;

        if (this.id !== "bof-step-content") return;

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
            option.innerHTML = optionMatch[4];
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
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    querySelectorAll(selector) {
        return selector === "[data-select-option]" ? this.options : [];
    }

    querySelector(selector) {
        if (selector === ".bof-step-title") return this.titleElement;
        return null;
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

const elements = Object.fromEntries(
    ids.map((id) => [id, new FakeElement(id)])
);
const startButton = new FakeElement("bof-start");
elements["bof-intro"].hidden = false;
elements["bof-assessment"].hidden = true;
elements["bof-report"].hidden = true;

const document = {
    getElementById(id) {
        return elements[id] ||
            elements["bof-step-content"].generatedInputs[id] ||
            null;
    },
    querySelectorAll(selector) {
        return selector === "[data-bof-start]" ? [startButton] : [];
    }
};

const window = {
    scrollTo() {}
};

vm.runInNewContext(source, {
    document,
    window,
    console,
    navigator: {},
    setTimeout,
    clearTimeout
});

function click(element) {
    assert.ok(element.listeners.click, "Expected click handler on " + element.id);
    element.listeners.click({ target: element });
}

function choose(value) {
    const content = elements["bof-step-content"];
    const option = content.options.find(
        (item) => item.dataset.selectOption === value
    );
    assert.ok(option, "Expected visible option: " + value);
    assert.ok(option.closest("[data-select-option]"), "Option must support delegated selection");
    content.listeners.click({ target: option });
}

function next() {
    click(elements["bof-continue"]);
}

function completeAssessment({ discovery, contact, friction, priority, businessName }) {
    click(startButton);
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

    next();
    discovery.forEach(choose);
    next();
    choose(contact);
    next();
    friction.forEach(choose);
    next();
    choose(priority);
    next();

    assert.equal(elements["bof-assessment"].hidden, true);
    assert.equal(elements["bof-report"].hidden, false);
    return elements["bof-report-content"].innerHTML;
}

// Case 1: Instagram, Facebook and Google Business Profile are declared,
// but website status is not answered. The report must not infer no website.
const firstReport = completeAssessment({
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
assert.doesNotMatch(firstReport, /Website: No website reported/);
assert.match(firstReport, /Self-reported/);
assert.match(firstReport, /AI Customer Reply Setup/);
assert.doesNotMatch(firstReport, /Website Design &amp; Development/);

// Case 2: Explicitly saying "no website" must be reflected, but must not
// automatically trigger a website recommendation when the selected issue
// is enquiry follow-through rather than information clarity or credibility.
click(elements["bof-restart"]);
const secondReport = completeAssessment({
    discovery: ["no_website", "instagram"],
    contact: "whatsapp",
    friction: ["missed_followups"],
    priority: "responses"
});
assert.match(secondReport, /Website: No website reported/);
assert.doesNotMatch(secondReport, /Website Design &amp; Development/);
assert.match(secondReport, /AI Customer Reply Setup/);

// Case 3: The "no online presence" answer supersedes a separate no-website
// answer because it already includes that condition.
click(elements["bof-restart"]);
const thirdReport = completeAssessment({
    discovery: ["no_website", "no_online_presence", "referrals"],
    contact: "phone",
    friction: ["not_sure"],
    priority: "exploring"
});
assert.match(thirdReport, /Website: No online presence reported/);
assert.doesNotMatch(thirdReport, /Website: No website reported/);
assert.match(thirdReport, /business does not currently have an online presence/i);
assert.doesNotMatch(thirdReport, /Website Design &amp; Development/);

console.log("Business Opportunity Finder interactive flow tests passed.");
