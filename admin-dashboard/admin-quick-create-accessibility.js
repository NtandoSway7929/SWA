(function () {
    "use strict";

    const WORKSPACE_ID = "sway-admin-workspace";
    const WRAPPER_SELECTOR = ".sway-quick-create";
    const MENU_SELECTOR = ".sway-quick-create-menu";
    const TOGGLE_SELECTOR = ".sway-quick-create-toggle";

    function getParts(wrapper) {
        if (!wrapper) return null;

        return {
            wrapper: wrapper,
            toggle: wrapper.querySelector(TOGGLE_SELECTOR),
            menu: wrapper.querySelector(MENU_SELECTOR),
            heading: wrapper.querySelector(".sway-quick-create-heading"),
            grid: wrapper.querySelector(".sway-quick-create-grid")
        };
    }

    function enhanceQuickCreate(workspace) {
        const parts = getParts(workspace.querySelector(WRAPPER_SELECTOR));
        if (!parts) return;

        if (parts.toggle &&
            parts.toggle.getAttribute("aria-label") !== "Quick-create actions") {
            parts.toggle.setAttribute("aria-label", "Quick-create actions");
        }

        if (parts.heading && parts.heading.id !== "sway-quick-create-heading") {
            parts.heading.id = "sway-quick-create-heading";
        }

        if (parts.menu && parts.menu.getAttribute("role") !== "group") {
            parts.menu.setAttribute("role", "group");
        }

        if (parts.menu && parts.heading &&
            parts.menu.getAttribute("aria-labelledby") !== parts.heading.id) {
            parts.menu.setAttribute("aria-labelledby", parts.heading.id);
        }
    }

    function closeMenu(wrapper) {
        const parts = getParts(wrapper);
        if (!parts || !parts.menu || !parts.toggle) return;

        parts.menu.hidden = true;
        parts.toggle.setAttribute("aria-expanded", "false");
        parts.wrapper.classList.remove("open");
    }

    function install() {
        const workspace = document.getElementById(WORKSPACE_ID);
        if (!workspace) return;

        enhanceQuickCreate(workspace);

        // renderShell() rebuilds this part of the DOM during workspace navigation.
        // Reapply the semantic labels whenever the quick-create control is replaced.
        if (typeof MutationObserver === "function") {
            const observer = new MutationObserver(function () {
                enhanceQuickCreate(workspace);
            });
            observer.observe(workspace, {
                childList: true,
                subtree: true
            });
        }

        // The workspace's native toggle handler runs before this document-level
        // listener. A keyboard-generated click therefore reaches this handler
        // after the menu has opened, allowing focus to enter the action group.
        document.addEventListener("click", function (event) {
            const target = event.target;
            const toggle = target && typeof target.closest === "function"
                ? target.closest(TOGGLE_SELECTOR)
                : null;

            if (!toggle || event.detail !== 0) return;

            const wrapper = toggle.closest(WRAPPER_SELECTOR);
            const parts = getParts(wrapper);
            if (!parts || !parts.menu || parts.menu.hidden) return;

            const firstAction = parts.menu.querySelector("[data-global-quick]");
            if (firstAction) firstAction.focus();
        });

        // The existing workspace handler closes the menu on Escape. Restore
        // focus in the capture phase so the focused action is not hidden first.
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") return;

            const wrapper = workspace.querySelector(WRAPPER_SELECTOR);
            const parts = getParts(wrapper);
            if (!parts || !parts.menu || parts.menu.hidden || !parts.toggle) return;

            if (parts.menu.contains(document.activeElement)) {
                parts.toggle.focus();
            }
        }, true);

        // Tabbing out of the disclosure closes it without pulling focus back.
        document.addEventListener("focusout", function (event) {
            const target = event.target;
            const wrapper = target && typeof target.closest === "function"
                ? target.closest(WRAPPER_SELECTOR)
                : null;

            if (!wrapper || (event.relatedTarget && wrapper.contains(event.relatedTarget))) {
                return;
            }

            const parts = getParts(wrapper);
            if (!parts || !parts.menu || parts.menu.hidden) return;

            closeMenu(wrapper);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
        install();
    }
})();
