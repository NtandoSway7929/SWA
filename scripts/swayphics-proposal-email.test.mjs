import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const helperPath = fileURLToPath(
    new URL("../admin-dashboard/proposal-email-prefill.js", import.meta.url)
);
const helperSource = readFileSync(helperPath, "utf8");
const context = { window: {} };

vm.runInNewContext(helperSource, context, {
    filename: helperPath
});

const createPrefill = context.window.SwayphicsProposalEmail.createPrefill;

test("builds a generic email draft for the proposal's matching lead", () => {
    const result = createPrefill(
        {
            lead_id: "lead-1",
            subject: "A tailored proposal",
            content: "Hello,\n\nHere is the proposal."
        },
        {
            id: "lead-1",
            email: "owner@example.com",
            status: "contacted"
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        subject: "A tailored proposal",
        message: "Hello,\n\nHere is the proposal.",
        proposalType: "not-website-related",
        lockRecipient: true,
        preparedFromProposal: true
    });
});

test("does not prepare a proposal for a different lead", () => {
    assert.equal(
        createPrefill(
            { lead_id: "lead-1", content: "Proposal" },
            { id: "lead-2", email: "owner@example.com" }
        ),
        null
    );
});

test("requires an eligible lead email and proposal content", () => {
    const proposal = { lead_id: "lead-1", content: "Proposal" };

    assert.equal(
        createPrefill(proposal, { id: "lead-1", email: "not-an-email" }),
        null
    );
    assert.equal(
        createPrefill(proposal, {
            id: "lead-1",
            email: "owner@example.com",
            status: "not interested"
        }),
        null
    );
    assert.equal(
        createPrefill(
            { lead_id: "lead-1", content: "   " },
            { id: "lead-1", email: "owner@example.com" }
        ),
        null
    );
});

test("prepares drafts only for leads in an active pipeline status", () => {
    const proposal = { lead_id: "lead-1", content: "Proposal" };
    const activeLead = {
        id: "lead-1",
        email: "owner@example.com",
        status: "proposal sent"
    };

    assert.ok(createPrefill(proposal, activeLead));

    for (const status of ["not interested", "won", "lost", "", "archived"]) {
        assert.equal(
            createPrefill(proposal, {
                ...activeLead,
                status
            }),
            null,
            `status ${JSON.stringify(status)} must not be eligible`
        );
    }
});

test("rejects content that exceeds the email composer limit", () => {
    assert.equal(
        createPrefill(
            { lead_id: "lead-1", content: "x".repeat(10001) },
            { id: "lead-1", email: "owner@example.com" }
        ),
        null
    );
});
