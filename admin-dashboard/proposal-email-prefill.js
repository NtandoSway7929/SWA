(function (root) {
    "use strict";

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
            leadStatus === "not_interested" ||
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

    root.SwayphicsProposalEmail = Object.freeze({
        createPrefill
    });
})(typeof window === "undefined" ? globalThis : window);
