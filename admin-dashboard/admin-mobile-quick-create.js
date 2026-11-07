(function () {
    "use strict";

    const workspace = document.getElementById("sway-admin-workspace");
    if (!workspace || typeof MutationObserver !== "function") return;

    const MOBILE_DOCK_BREAKPOINT = 520;
    const DOCKED_CLASS = "sway-quick-create-docked";
    const ACTIONS_CLASS = "sway-quick-create-docked-actions";
    let quickCreate = null;

    function syncQuickCreatePlacement() {
        const shell = workspace.querySelector(".sway-workspace-shell");
        const main = workspace.querySelector("#sway-workspace-main");
        if (!shell || !main) return;

        // renderShell() replaces this node. Keep the newest one, while
        // retaining the previous node if a view-only render detached it.
        const renderedQuickCreate = workspace.querySelector(".sway-quick-create");
        if (renderedQuickCreate) {
            quickCreate = renderedQuickCreate;
        }

        if (!quickCreate) return;

        // renderView() may replace main.innerHTML while the quick-create
        // element is docked inside the old heading. Reattach it before
        // deciding where the newly rendered view needs it.
        if (!workspace.contains(quickCreate)) {
            main.insertAdjacentElement("afterend", quickCreate);
        }

        const actionSlot = main.querySelector(".sway-workspace-heading-actions");
        const hasPageCreateAction = Boolean(
            actionSlot && actionSlot.querySelector("[data-add]")
        );
        const shouldDock =
            window.innerWidth <= MOBILE_DOCK_BREAKPOINT &&
            hasPageCreateAction;

        if (shouldDock) {
            actionSlot.classList.add(ACTIONS_CLASS);
            if (quickCreate.parentElement !== actionSlot) {
                actionSlot.appendChild(quickCreate);
            }
            quickCreate.classList.add(DOCKED_CLASS);
            return;
        }

        if (actionSlot) {
            actionSlot.classList.remove(ACTIONS_CLASS);
        }
        quickCreate.classList.remove(DOCKED_CLASS);

        // Keep the desktop/tablet floating placement and preserve the
        // original shell order: navigation, main view, quick-create.
        if (
            quickCreate.parentElement !== shell ||
            quickCreate.previousElementSibling !== main
        ) {
            main.insertAdjacentElement("afterend", quickCreate);
        }
    }

    const observer = new MutationObserver(syncQuickCreatePlacement);
    observer.observe(workspace, {
        childList: true,
        subtree: true
    });

    window.addEventListener("resize", syncQuickCreatePlacement, {
        passive: true
    });

    syncQuickCreatePlacement();
})();
