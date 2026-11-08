(function () {
    "use strict";
    const shortcuts = ["ArrowDown", "ArrowUp", "Home", "End"];

    function isVisibleConversation(button) {
        if (!button || button.disabled || button.closest("[hidden]")) return false;
        const style = window.getComputedStyle(button);
        return style.display !== "none" &&
            style.visibility !== "hidden" &&
            button.getClientRects().length > 0;
    }

    function markConversationShortcuts() {
        document.querySelectorAll("[data-email-thread]").forEach(function (button) {
            if (button.getAttribute("aria-keyshortcuts") !== shortcuts.join(" ")) {
                button.setAttribute("aria-keyshortcuts", shortcuts.join(" "));
            }
        });
    }

    document.addEventListener("keydown", function (event) {
        if (!shortcuts.includes(event.key)) return;
        const current = event.target && typeof event.target.closest === "function"
            ? event.target.closest("[data-email-thread]")
            : null;
        if (!current) return;

        const conversations = Array.from(document.querySelectorAll("[data-email-thread]"))
            .filter(isVisibleConversation);
        const currentIndex = conversations.indexOf(current);
        if (currentIndex < 0 || conversations.length < 2) return;

        let nextIndex = currentIndex;
        if (event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % conversations.length;
        } else if (event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + conversations.length) % conversations.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = conversations.length - 1;
        }
        event.preventDefault();
        conversations[nextIndex].focus();
    });

    const observer = new MutationObserver(markConversationShortcuts);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-email-thread", "disabled", "hidden"]
    });
    markConversationShortcuts();
})();
