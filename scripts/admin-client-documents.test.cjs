"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-workspace.js"),
    "utf8"
);
const html = fs.readFileSync(
    path.join(root, "admin-dashboard", "index.html"),
    "utf8"
);

function functionSection(source, marker, label) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, label + " function must exist");
    const nextFunction = /\n    (?:async )?function [A-Za-z_$][\w$]*\(/g;
    nextFunction.lastIndex = start + marker.length;
    const end = nextFunction.exec(source);
    assert.ok(end, label + " function boundary must be detectable");
    return source.slice(start, end.index);
}

const client360 = functionSection(
    workspace,
    "    function openClient360(",
    "Client 360"
);
assert.ok(
    client360.includes("Documents &amp; deliverables"),
    "Client 360 should clearly label the client-facing document area"
);
assert.ok(
    client360.includes("data-upload-client-document"),
    "Client 360 should expose the client-specific upload action"
);
assert.ok(
    client360.includes("Upload to client portal"),
    "the upload action should explain the delivery destination"
);
assert.match(
    client360,
    /openDocumentUploadModal\(\s*button\.dataset\.uploadClientDocument\s*\)/,
    "the Client 360 upload action should open the uploader for that client"
);

const uploadModal = functionSection(
    workspace,
    "    async function openDocumentUploadModal(",
    "document upload modal"
);
assert.match(
    uploadModal,
    /const buildProjectOptions = function\s*\(clientId, selectedProjectId\)/,
    "the uploader should build project choices for the selected client"
);
assert.match(
    uploadModal,
    /String\(project\.client_id \|\| ""\) === String\(clientId\)/,
    "project choices must be limited to projects owned by the selected client"
);
assert.match(
    uploadModal,
    /clientSelectForProjects\.addEventListener\("change"/,
    "changing the client in the general uploader must refresh its project choices"
);
assert.match(
    uploadModal,
    /prefillClientId \? " disabled" : ""/,
    "uploads launched from Client 360 must remain attached to that client"
);
assert.match(
    uploadModal,
    /openClient360\(selectedClientId\)/,
    "a successful Client 360 upload should return to the same client record"
);
assert.match(
    uploadModal,
    /added to the client's private portal/,
    "upload success should confirm client portal delivery"
);

const uploadFunction = functionSection(
    workspace,
    "    async function uploadClientDocument(",
    "client document uploader"
);
assert.match(workspace, /CLIENT_DOCUMENT_BUCKET\s*=\s*["']swayphics-client-files["']/);
assert.ok(
    uploadFunction.includes("String(clientId)") &&
    uploadFunction.includes('"/"') &&
    uploadFunction.includes("uniqueName"),
    "stored object paths must be namespaced under the selected client ID"
);
assert.match(
    uploadFunction,
    /Choose a project linked to the selected client/,
    "the uploader must reject project/client mismatches before Storage upload"
);
assert.match(uploadFunction, /client_id:\s*clientId/);
assert.match(uploadFunction, /storage_path:\s*storagePath/);
assert.match(uploadFunction, /uploaded_by:\s*state\.currentUser\.id/);

assert.match(
    html,
    /admin-workspace\.js\?v=20261108-client-document-sharing-1/,
    "the admin workspace script URL should be versioned to refresh the updated workflow"
);

console.log("Admin client document upload and portal-sharing tests passed.");
