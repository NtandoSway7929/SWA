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

const proposalEmail = context.window.SwayphicsProposalEmail;
const createPrefill = proposalEmail.createPrefill;
const approveAndPrepareEmail = proposalEmail.approveAndPrepareEmail;
const proposal = {
    id: "proposal-1",
    lead_id: "lead-1",
    title: "A tailored proposal",
    subject: "A tailored proposal for your business",
    content: "Hello,\n\nHere is the proposal."
};
const activeLead = {
    id: "lead-1",
    email: "owner@example.com",
    status: "contacted"
};

test("builds the expected subject and content prefill for the linked lead", () => {
    const result = createPrefill(proposal, activeLead);

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        subject: "A tailored proposal for your business",
        message: "Hello,\n\nHere is the proposal.",
        proposalType: "not-website-related",
        lockRecipient: true,
        preparedFromProposal: true
    });
});

test("rejects a proposal whose lead ID does not match", () => {
    assert.equal(
        createPrefill(proposal, {
            ...activeLead,
            id: "lead-2"
        }),
        null
    );
});

test("requires a valid email and non-empty proposal content", () => {
    assert.equal(
        createPrefill(proposal, {
            ...activeLead,
            email: "not-an-email"
        }),
        null
    );
    assert.equal(
        createPrefill(proposal, {
            ...activeLead,
            email: ""
        }),
        null
    );
    assert.equal(
        createPrefill(
            { ...proposal, content: "   " },
            activeLead
        ),
        null
    );
    assert.equal(
        createPrefill(
            { ...proposal, content: "x".repeat(10001) },
            activeLead
        ),
        null
    );
});

test("only active pipeline statuses can prepare a proposal email", () => {
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

    for (const status of [
        "new",
        "contacted",
        "interested",
        "proposal sent",
        "negotiating",
        "follow-up"
    ]) {
        assert.ok(
            createPrefill(proposal, {
                ...activeLead,
                status
            }),
            `status ${JSON.stringify(status)} should be eligible`
        );
    }
});

test("approval opens a lead-locked draft without sending an email", async () => {
    const calls = [];
    let sendCount = 0;

    const approvedProposal = await approveAndPrepareEmail(
        proposal,
        activeLead,
        {
            approveProposal: async function (draft) {
                calls.push(["approve", draft.id]);
                return [{ ...draft, status: "approved" }];
            },
            onApprovalConfirmed: async function (approved) {
                calls.push(["confirmed", approved.id]);
            },
            openComposer: function (...args) {
                calls.push(["composer", ...args]);
            },
            sendEmail: function () {
                sendCount += 1;
            }
        }
    );

    assert.equal(approvedProposal.status, "approved");
    assert.deepEqual(calls.map(function (call) { return call[0]; }), [
        "approve",
        "confirmed",
        "composer"
    ]);
    assert.deepEqual(
        JSON.parse(JSON.stringify(calls[2].slice(1))),
        [
            "lead",
            "lead-1",
            null,
            {
                subject: "A tailored proposal for your business",
                message: "Hello,\n\nHere is the proposal.",
                proposalType: "not-website-related",
                lockRecipient: true,
                preparedFromProposal: true
            }
        ]
    );
    assert.equal(sendCount, 0);
});

test("does not open a composer or send when proposal approval fails", async () => {
    let composerCount = 0;
    let sendCount = 0;

    await assert.rejects(
        approveAndPrepareEmail(proposal, activeLead, {
            approveProposal: async function () {
                throw new Error("approval failed");
            },
            openComposer: function () {
                composerCount += 1;
            },
            sendEmail: function () {
                sendCount += 1;
            }
        }),
        /approval failed/
    );

    assert.equal(composerCount, 0);
    assert.equal(sendCount, 0);
});

test("does not prepare a draft when the approval response is mismatched or incomplete", async () => {
    for (const approvalResult of [
        { ...proposal, id: "another-proposal", status: "approved" },
        { ...proposal, status: "draft" }
    ]) {
        let composerCount = 0;
        let sendCount = 0;

        await assert.rejects(
            approveAndPrepareEmail(proposal, activeLead, {
                approveProposal: async function () {
                    return approvalResult;
                },
                openComposer: function () {
                    composerCount += 1;
                },
                sendEmail: function () {
                    sendCount += 1;
                }
            }),
            /approval could not be confirmed/
        );

        assert.equal(composerCount, 0);
        assert.equal(sendCount, 0);
    }
});

test("rejects an ineligible lead before attempting proposal approval", async () => {
    let approvalCount = 0;
    let composerCount = 0;

    await assert.rejects(
        approveAndPrepareEmail(proposal, {
            ...activeLead,
            status: "not interested"
        }, {
            approveProposal: async function () {
                approvalCount += 1;
                return { ...proposal, status: "approved" };
            },
            openComposer: function () {
                composerCount += 1;
            }
        }),
        /matching active lead/
    );

    assert.equal(approvalCount, 0);
    assert.equal(composerCount, 0);
});
