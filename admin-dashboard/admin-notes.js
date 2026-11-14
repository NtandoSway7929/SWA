(function () {
    "use strict";

    var LAYER_ID = "sway-admin-notes-layer";
    var LAUNCHER_SELECTOR = "[data-sway-notes-launcher]";
    var STORAGE_PREFIX = "swayphics_admin_notes_v1_";
    var userId = "";
    var notes = [];
    var selectedId = "";
    var saveTimer = null;
    var dirty = false;
    var isOpen = false;
    var previousBodyOverflow = "";
    var observer = null;
    var layer = null;

    function verifiedAdminId() {
        var value = window.swayphicsVerifiedAdminUserId;
        return typeof value === "string" ? value.trim() : "";
    }

    function storageKey(id) {
        return STORAGE_PREFIX + encodeURIComponent(id);
    }

    function escapeHTML(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    function createId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "note-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 11);
    }

    function selectedNote() {
        return notes.find(function (note) {
            return note.id === selectedId;
        }) || null;
    }

    function setStatus(message) {
        var status = layer && layer.querySelector("[data-notes-status]");
        if (status) status.textContent = message;
    }

    function loadNotes() {
        notes = [];
        selectedId = "";
        dirty = false;

        try {
            var stored = window.localStorage.getItem(storageKey(userId));
            if (!stored) return;
            var parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) return;

            notes = parsed.filter(function (item) {
                return item && typeof item === "object" && typeof item.id === "string";
            }).map(function (item) {
                var createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
                return {
                    id: item.id,
                    title: String(item.title || "").slice(0, 140),
                    content: String(item.content || ""),
                    pinned: item.pinned === true,
                    createdAt: createdAt,
                    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt
                };
            });
            if (notes.length) selectedId = notes[0].id;
        } catch (error) {
            notes = [];
            selectedId = "";
            console.warn("Swayphics Notes could not read this browser's saved notes.", error);
            setStatus("Notes could not be read from this browser");
        }
    }

    function formatDate(value) {
        if (!value) return "Not saved yet";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Recently updated";
        try {
            return new Intl.DateTimeFormat("en-ZA", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }).format(date);
        } catch (error) {
            return date.toLocaleString();
        }
    }

    function sortedNotes() {
        return notes.slice().sort(function (a, b) {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return String(b.updatedAt).localeCompare(String(a.updatedAt));
        });
    }

    function renderList() {
        if (!layer) return;
        var list = layer.querySelector("[data-notes-list]");
        var count = layer.querySelector("[data-notes-count]");
        var search = layer.querySelector("[data-notes-search]");
        var query = search ? search.value.trim().toLowerCase() : "";
        var visible = sortedNotes().filter(function (note) {
            return !query || (note.title + " " + note.content).toLowerCase().includes(query);
        });

        if (count) count.textContent = notes.length + (notes.length === 1 ? " note" : " notes");
        if (!list) return;

        if (!visible.length) {
            list.innerHTML = notes.length
                ? '<div class="sway-notes-list-empty">No notes match that search.</div>'
                : '<div class="sway-notes-list-empty"><strong>No notes yet</strong><span>Create a note to capture an idea, decision or reminder.</span></div>';
            return;
        }

        list.innerHTML = visible.map(function (note) {
            var title = note.title.trim() || "Untitled note";
            var preview = note.content.replace(/\s+/g, " ").trim();
            if (preview.length > 116) preview = preview.slice(0, 113) + "...";
            return (
                '<button type="button" class="sway-notes-item' + (note.id === selectedId ? " is-selected" : "") + '" data-note-id="' + escapeHTML(note.id) + '">' +
                    '<span class="sway-notes-item-top">' +
                        '<strong>' + escapeHTML(title) + '</strong>' +
                        (note.pinned ? '<span class="sway-notes-pinned-label">Pinned</span>' : "") +
                    '</span>' +
                    '<span class="sway-notes-item-preview">' + escapeHTML(preview || "No additional text") + '</span>' +
                    '<span class="sway-notes-item-date">' + escapeHTML(formatDate(note.updatedAt)) + '</span>' +
                '</button>'
            );
        }).join("");
    }

    function renderEditor() {
        if (!layer) return;
        var editor = layer.querySelector("[data-notes-editor]");
        var emptyState = layer.querySelector("[data-notes-empty]");
        var title = layer.querySelector("[data-notes-title]");
        var body = layer.querySelector("[data-notes-body]");
        var pin = layer.querySelector("[data-notes-pin]");
        var remove = layer.querySelector("[data-notes-delete]");
        var meta = layer.querySelector("[data-notes-meta]");
        var note = selectedNote();

        if (!note) {
            if (editor) editor.hidden = true;
            if (emptyState) emptyState.hidden = false;
            return;
        }

        if (editor) editor.hidden = false;
        if (emptyState) emptyState.hidden = true;
        if (title) title.value = note.title;
        if (body) body.value = note.content;
        if (pin) pin.textContent = note.pinned ? "Unpin note" : "Pin note";
        if (meta) meta.textContent = "Created " + formatDate(note.createdAt) + " · Updated " + formatDate(note.updatedAt);
        if (remove) remove.disabled = false;
    }

    function render() {
        renderList();
        renderEditor();
        if (layer) {
            var newButton = layer.querySelector("[data-notes-new]");
            var pinButton = layer.querySelector("[data-notes-pin]");
            var deleteButton = layer.querySelector("[data-notes-delete]");
            var saveButton = layer.querySelector("[data-notes-save]");
            var hasNote = Boolean(selectedNote());
            if (newButton) newButton.disabled = false;
            if (pinButton) pinButton.disabled = !hasNote;
            if (deleteButton) deleteButton.disabled = !hasNote;
            if (saveButton) saveButton.disabled = !hasNote;
        }
    }

    function saveNow() {
        if (saveTimer) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (!userId || userId !== verifiedAdminId()) {
            setStatus("Admin session changed · sign in again");
            return false;
        }
        if (!dirty) {
            if (isOpen) setStatus("Saved locally · this browser only");
            return true;
        }

        var now = new Date().toISOString();
        var note = selectedNote();
        if (note) note.updatedAt = now;

        try {
            window.localStorage.setItem(storageKey(userId), JSON.stringify(notes));
            dirty = false;
            renderList();
            if (note) {
                var meta = layer && layer.querySelector("[data-notes-meta]");
                if (meta) meta.textContent = "Created " + formatDate(note.createdAt) + " · Updated " + formatDate(note.updatedAt);
            }
            setStatus("Saved locally · this browser only");
            return true;
        } catch (error) {
            console.warn("Swayphics Notes could not save to this browser.", error);
            setStatus("Could not save · browser storage unavailable");
            return false;
        }
    }

    function scheduleSave() {
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveNow, 650);
    }

    function markChanged() {
        dirty = true;
        setStatus("Unsaved changes");
        scheduleSave();
    }

    function createNote() {
        saveNow();
        var now = new Date().toISOString();
        var note = {
            id: createId(),
            title: "",
            content: "",
            pinned: false,
            createdAt: now,
            updatedAt: now
        };
        notes.unshift(note);
        selectedId = note.id;
        dirty = true;
        saveNow();
        render();
        setStatus("New note saved locally");
        var title = layer && layer.querySelector("[data-notes-title]");
        if (title) {
            title.focus();
            title.select();
        }
    }

    function selectNote(id) {
        if (id === selectedId) return;
        saveNow();
        if (!notes.some(function (note) { return note.id === id; })) return;
        selectedId = id;
        render();
        setStatus("Saved locally · this browser only");
        var title = layer && layer.querySelector("[data-notes-title]");
        if (title) title.focus();
    }

    function togglePin() {
        var note = selectedNote();
        if (!note) return;
        note.pinned = !note.pinned;
        dirty = true;
        saveNow();
        render();
    }

    function deleteSelectedNote() {
        var note = selectedNote();
        if (!note) return;
        var title = note.title.trim() || "Untitled note";
        if (!window.confirm('Delete "' + title + '"? This cannot be undone.')) return;

        notes = notes.filter(function (item) {
            return item.id !== note.id;
        });
        selectedId = notes.length ? sortedNotes()[0].id : "";
        dirty = true;
        saveNow();
        render();
        setStatus("Note deleted");
    }

    function buildLayer() {
        if (layer || !document.body) return;
        layer = document.createElement("div");
        layer.id = LAYER_ID;
        layer.className = "sway-notes-overlay";
        layer.hidden = true;
        layer.setAttribute("role", "dialog");
        layer.setAttribute("aria-modal", "true");
        layer.setAttribute("aria-labelledby", "sway-notes-heading");
        layer.innerHTML =
            '<section class="sway-notes-window">' +
                '<header class="sway-notes-header">' +
                    '<div class="sway-notes-heading-copy">' +
                        '<span class="sway-notes-eyebrow">SWAYPHICS WORKSPACE</span>' +
                        '<h1 id="sway-notes-heading">Notes</h1>' +
                        '<p>Capture ideas, decisions and the details worth keeping.</p>' +
                    '</div>' +
                    '<div class="sway-notes-header-actions">' +
                        '<span class="sway-notes-save-status" data-notes-status aria-live="polite">Saved locally · this browser only</span>' +
                        '<button type="button" class="sway-notes-close" data-notes-close aria-label="Close Notes">' +
                            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</header>' +
                '<div class="sway-notes-toolbar">' +
                    '<label class="sway-notes-search">' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 4.1 4.1"/></svg>' +
                        '<input type="search" data-notes-search placeholder="Search your notes" aria-label="Search notes">' +
                    '</label>' +
                    '<span class="sway-notes-count" data-notes-count>0 notes</span>' +
                    '<button type="button" class="sway-notes-new" data-notes-new>' +
                        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
                        'New note' +
                    '</button>' +
                '</div>' +
                '<div class="sway-notes-content">' +
                    '<aside class="sway-notes-sidebar">' +
                        '<div class="sway-notes-list-heading"><strong>Your notes</strong><span>Most recently updated</span></div>' +
                        '<div class="sway-notes-list" data-notes-list></div>' +
                    '</aside>' +
                    '<section class="sway-notes-workspace">' +
                        '<div class="sway-notes-empty" data-notes-empty>' +
                            '<div class="sway-notes-empty-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 7.5h14l7 7V39H14z"/><path d="M28 7.5v8h7M19 23h11M19 29h11M19 35h7"/></svg></div>' +
                            '<h2>Your notes start here</h2>' +
                            '<p>Create a note to keep an idea, decision or reminder close at hand.</p>' +
                            '<button type="button" class="sway-notes-new sway-notes-empty-cta" data-notes-new>Write your first note</button>' +
                        '</div>' +
                        '<div class="sway-notes-editor" data-notes-editor hidden>' +
                            '<div class="sway-notes-editor-top">' +
                                '<div class="sway-notes-title-wrap">' +
                                    '<label for="sway-notes-title">NOTE TITLE</label>' +
                                    '<input id="sway-notes-title" type="text" maxlength="140" data-notes-title placeholder="Untitled note" autocomplete="off">' +
                                '</div>' +
                                '<div class="sway-notes-editor-actions">' +
                                    '<button type="button" class="sway-notes-secondary" data-notes-pin>Pin note</button>' +
                                    '<button type="button" class="sway-notes-primary" data-notes-save>Save note</button>' +
                                    '<button type="button" class="sway-notes-delete" data-notes-delete>Delete</button>' +
                                '</div>' +
                            '</div>' +
                            '<textarea class="sway-notes-body" data-notes-body placeholder="Start writing...&#10;&#10;Your notes are saved automatically as you type." aria-label="Note content"></textarea>' +
                            '<div class="sway-notes-editor-footer"><span data-notes-meta></span><span>Plain text · Auto-save enabled</span></div>' +
                        '</div>' +
                    '</section>' +
                '</div>' +
            '</section>';

        document.body.appendChild(layer);

        layer.querySelector("[data-notes-close]").addEventListener("click", closePanel);
        layer.querySelectorAll("[data-notes-new]").forEach(function (button) {
            button.addEventListener("click", createNote);
        });
        layer.querySelector("[data-notes-search]").addEventListener("input", renderList);
        layer.querySelector("[data-notes-list]").addEventListener("click", function (event) {
            var button = event.target.closest("[data-note-id]");
            if (button) selectNote(button.getAttribute("data-note-id"));
        });
        layer.querySelector("[data-notes-title]").addEventListener("input", function (event) {
            var note = selectedNote();
            if (!note) return;
            note.title = event.target.value.slice(0, 140);
            markChanged();
            renderList();
        });
        layer.querySelector("[data-notes-body]").addEventListener("input", function (event) {
            var note = selectedNote();
            if (!note) return;
            note.content = event.target.value;
            markChanged();
        });
        layer.querySelector("[data-notes-save]").addEventListener("click", saveNow);
        layer.querySelector("[data-notes-pin]").addEventListener("click", togglePin);
        layer.querySelector("[data-notes-delete]").addEventListener("click", deleteSelectedNote);
        layer.addEventListener("click", function (event) {
            if (event.target === layer) closePanel();
        });
    }

    function openPanel() {
        var activeUserId = verifiedAdminId();
        if (!activeUserId) return;
        if (userId !== activeUserId) {
            userId = activeUserId;
            loadNotes();
        }
        buildLayer();
        if (!layer) return;
        isOpen = true;
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        layer.hidden = false;
        updateLauncherState(true);
        render();
        setStatus("Saved locally · this browser only");
        window.setTimeout(function () {
            var title = layer && layer.querySelector("[data-notes-title]");
            var search = layer && layer.querySelector("[data-notes-search]");
            if (title && selectedNote()) title.focus();
            else if (search) search.focus();
        }, 0);
    }

    function closePanel() {
        if (!isOpen) return;
        saveNow();
        isOpen = false;
        if (layer) layer.hidden = true;
        document.body.style.overflow = previousBodyOverflow;
        updateLauncherState(false);
        var launcher = document.querySelector(LAUNCHER_SELECTOR);
        if (launcher) launcher.focus();
    }

    function updateLauncherState(open) {
        document.querySelectorAll(LAUNCHER_SELECTOR).forEach(function (button) {
            button.setAttribute("aria-expanded", String(Boolean(open)));
        });
    }

    function ensureLauncher() {
        var activeUserId = verifiedAdminId();
        if (!activeUserId) return;

        if (userId !== activeUserId) {
            if (isOpen) closePanel();
            userId = activeUserId;
            loadNotes();
        }

        var nav = document.querySelector("#sway-admin-workspace .sway-workspace-nav-scroll");
        if (!nav || nav.querySelector(LAUNCHER_SELECTOR)) return;

        var button = document.createElement("button");
        button.type = "button";
        button.className = "sway-settings-direct-nav sway-notes-nav-button";
        button.setAttribute("data-sway-notes-launcher", "true");
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", String(isOpen));
        button.innerHTML =
            '<span class="sway-notes-nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8h7.8l4.2 4.3v12.1H7z"/><path d="M14.8 3.8v4.6H19M10.2 12h5.6M10.2 15.6h5.6"/></svg></span>' +
            '<span>Notes</span>';
        button.addEventListener("click", openPanel);
        nav.appendChild(button);
    }

    function handleKeys(event) {
        if (!isOpen) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closePanel();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
            event.preventDefault();
            saveNow();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "n") {
            event.preventDefault();
            createNote();
        }
    }

    function boot() {
        buildLayer();
        var workspace = document.getElementById("sway-admin-workspace");
        if (workspace && typeof MutationObserver !== "undefined") {
            observer = new MutationObserver(function () {
                ensureLauncher();
            });
            observer.observe(workspace, { childList: true, subtree: true });
        }
        ensureLauncher();
        document.addEventListener("keydown", handleKeys);
        window.addEventListener("beforeunload", saveNow);
        window.addEventListener("storage", function (event) {
            if (!userId || event.key !== storageKey(userId) || dirty) return;
            loadNotes();
            if (isOpen) render();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();