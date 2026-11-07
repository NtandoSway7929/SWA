(function () {
    "use strict";

    const WORKSPACE_ID = "sway-admin-workspace";
    const GENERATED_ATTRIBUTE = "data-row-action-accessible-name";

    function primaryCellLabel(row) {
        if (!row || !row.cells) return "";

        for (const cell of Array.from(row.cells)) {
            if (
                cell.classList.contains("sway-admin-table-select-cell") ||
                cell.querySelector(".sway-row-actions, .sway-lead-row-actions")
            ) {
                continue;
            }

            const label = String(cell.textContent || "")
                .replace(/\s+/g, " ")
                .trim();

            if (label) return label.slice(0, 100);
        }

        return "";
    }

    function enhanceSummary(summary) {
        const row = summary.closest("tr");
        const recordLabel = primaryCellLabel(row);
        if (!recordLabel) return;

        const generated = summary.getAttribute(GENERATED_ATTRIBUTE) === "true";
        if (summary.hasAttribute("aria-label") && !generated) return;

        const accessibleName = "Actions for " + recordLabel;
        if (summary.getAttribute("aria-label") !== accessibleName) {
            summary.setAttribute("aria-label", accessibleName);
        }

        if (!generated) {
            summary.setAttribute(GENERATED_ATTRIBUTE, "true");
        }
    }

    function enhanceRow(row) {
        if (!row || !row.querySelectorAll) return;

        row.querySelectorAll(
            ".sway-actions-menu > summary, .sway-lead-actions-menu > summary"
        ).forEach(enhanceSummary);
    }

    function enhanceSubtree(root) {
        if (!root || root.nodeType !== 1 || !root.querySelectorAll) return;

        if (root.matches("tr")) {
            enhanceRow(root);
            return;
        }

        root.querySelectorAll("tr").forEach(enhanceRow);
    }

    function install() {
        const workspace = document.getElementById(WORKSPACE_ID);
        if (!workspace) return;

        enhanceSubtree(workspace);

        if (typeof MutationObserver !== "function") return;

        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    const element = node.nodeType === 1
                        ? node
                        : node.parentElement;
                    if (!element) return;

                    const row = element.matches && element.matches("tr")
                        ? element
                        : element.closest && element.closest("tr");

                    if (row && workspace.contains(row)) {
                        enhanceRow(row);
                    } else {
                        enhanceSubtree(element);
                    }
                });

                // A record's primary cell can be refreshed in place without
                // replacing its row. Recompute its generated accessible name.
                if (
                    mutation.type === "childList" &&
                    mutation.target &&
                    mutation.target.closest
                ) {
                    const row = mutation.target.closest("tr");
                    if (row && workspace.contains(row)) {
                        enhanceRow(row);
                    }
                }
            });
        });

        observer.observe(workspace, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
        install();
    }
})();
