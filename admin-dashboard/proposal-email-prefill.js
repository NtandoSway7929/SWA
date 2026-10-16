(function (root) {
    "use strict";

    const activeLeadStatuses = Object.freeze([
        "new",
        "contacted",
        "interested",
        "proposal_sent",
        "negotiating",
        "follow-up"
    ]);

    function createPrefill(proposal, lead) {
        const draft = proposal || {};
        const contact = lead || {};
        const proposalLeadId = String(draft.lead_id || "").trim();
        const leadId = String(contact.id || "").trim();
        const email = String(contact.email || "").trim();
        const content = String(draft.content || "").trim();
        const leadStatus = String(contact.status || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");

        if (
            !proposalLeadId ||
            !leadId ||
            proposalLeadId !== leadId ||
            !activeLeadStatuses.includes(leadStatus) ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !content ||
            content.length > 10000
        ) {
            return null;
        }

        const subject = String(
            draft.subject || "Swayphics | Proposal"
        ).trim();

        if (!subject) {
            return null;
        }

        return {
            subject: subject.slice(0, 180),
            message: content,
            proposalType: "not-website-related",
            lockRecipient: true,
            preparedFromProposal: true
        };
    }

    async function approveAndPrepareEmail(proposal, lead, actions) {
        const draft = proposal || {};
        const contact = lead || {};
        const operations = actions || {};
        const proposalId = String(draft.id || "").trim();
        const leadId = String(contact.id || "").trim();
        const prefill = createPrefill(draft, contact);

        if (!proposalId || !prefill) {
            throw new Error(
                "A matching active lead, valid email and proposal content are required."
            );
        }

        if (
            typeof operations.approveProposal !== "function" ||
            typeof operations.openComposer !== "function"
        ) {
            throw new Error("Proposal email handoff actions are unavailable.");
        }

        const approvalResult =
            await operations.approveProposal(draft);
        const approvedProposal =
            Array.isArray(approvalResult)
                ? approvalResult[0]
                : approvalResult;

        if (
            !approvedProposal ||
            String(approvedProposal.id || "") !== proposalId ||
            String(approvedProposal.status || "").toLowerCase() !== "approved"
        ) {
            throw new Error(
                "Proposal approval could not be confirmed. No email draft was opened."
            );
        }

        if (typeof operations.onApprovalConfirmed === "function") {
            await operations.onApprovalConfirmed(approvedProposal);
        }

        operations.openComposer(
            "lead",
            leadId,
            null,
            prefill
        );

        return approvedProposal;
    }

    root.SwayphicsProposalEmail = Object.freeze({
        createPrefill,
        approveAndPrepareEmail
    });
})(typeof window === "undefined" ? globalThis : window);
