(function () {
    "use strict";

    // The Inbox is rendered again after a read-state PATCH. The original
    // action handler can hold a reference to a button that has been removed
    // from the document by that render. Observe the live document and restore
    // focus to the replacement button only after its read state has changed.
    document.addEventListener("click", function (event) {
        const source = event.target;
        const button = source && typeof source.closest === "function"
            ? source.closest("[data-email-thread-read-toggle]")
            : null;
        if (!button || button.disabled) return;

        const threadId = String(button.dataset.emailThreadReadToggle || "");
        const previousValue = String(button.dataset.emailReadValue || "");
        if (!threadId || (previousValue !== "true" && previousValue !== "false")) return;

        let observer = null;
        let timeoutId = null;
        let finished = false;

        function stopObserving() {
            if (finished) return;
            finished = true;
            if (observer) observer.disconnect();
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        }

        function findCurrentButton() {
            return Array.from(document.querySelectorAll("[data-email-thread-read-toggle]"))
                .find(function (candidate) {
                    return String(candidate.dataset.emailThreadReadToggle || "") === threadId;
                }) || null;
        }

        function restoreFocusAfterUpdate() {
            if (finished) return;
            const currentButton = findCurrentButton();
            if (!currentButton || currentButton.disabled ||
                String(currentButton.dataset.emailReadValue || "") === previousValue) {
                return;
            }

            stopObserving();
            currentButton.focus({ preventScroll: true });
            if (document.activeElement !== currentButton) currentButton.focus();
        }

        observer = new MutationObserver(restoreFocusAfterUpdate);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["data-email-read-value", "disabled"]
        });

        timeoutId = window.setTimeout(stopObserving, 15000);
    });
})();
