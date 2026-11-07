(function () {
    "use strict";

    const diagnostic = window.__swayInboxReadFocus = {
        loaded: true,
        clicks: 0,
        observerStarted: 0,
        changedStateDetected: 0,
        focusAttempts: 0,
        focusSucceeded: false
    };

    document.addEventListener("click", function (event) {
        const source = event.target;
        const button = source && typeof source.closest === "function"
            ? source.closest("[data-email-thread-read-toggle]")
            : null;
        if (!button || button.disabled) return;

        diagnostic.clicks += 1;
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

            diagnostic.changedStateDetected += 1;
            stopObserving();

            // Re-query in the next animation frame: renderView can perform
            // more than one DOM mutation, so focus the final live control.
            window.requestAnimationFrame(function () {
                const finalButton = findCurrentButton();
                if (!finalButton || finalButton.disabled) return;
                diagnostic.focusAttempts += 1;
                finalButton.focus({ preventScroll: true });
                if (document.activeElement !== finalButton) finalButton.focus();
                diagnostic.focusSucceeded = document.activeElement === finalButton;
            });
        }

        observer = new MutationObserver(restoreFocusAfterUpdate);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["data-email-read-value", "disabled"]
        });
        diagnostic.observerStarted += 1;

        timeoutId = window.setTimeout(stopObserving, 15000);
    }, true);
})();
