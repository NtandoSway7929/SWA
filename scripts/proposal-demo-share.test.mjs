import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createProposalDemoShareHandler,
  PROPOSAL_DEMO_BUCKET,
  SIGNED_FILE_URL_SECONDS,
} from "../supabase/functions/proposal-demo-share/handler.mjs";

const leadId = "11111111-1111-4111-8111-111111111111";
const otherLeadId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const shareId = "55555555-5555-4555-8555-555555555555";
const token = "Token_0123456789abcdefghijklmnopqrstuvwx_012";
const nowValue = "2026-10-16T20:00:00.000Z";

function baseVersion(overrides = {}) {
  return {
    id: versionId,
    lead_id: leadId,
    proposal_id: proposalId,
    version_number: 1,
    title: "Homepage concept",
    asset_kind: "hybrid",
    file_name: "concept.pdf",
    entry_path: "index.html",
    status: "published",
    published_at: "2026-10-16T19:00:00.000Z",
    ...overrides,
  };
}

function makeHandler(overrides = {}) {
  const calls = {
    proposalLookups: [],
    versionsInserted: [],
    sharesInserted: [],
    sharesRevoked: [],
    signedUrls: [],
    downloads: [],
    objectChecks: [],
  };
  const state = {
    proposal: { id: proposalId, lead_id: leadId },
    version: baseVersion(),
    share: {
      id: shareId,
      demo_version_id: versionId,
      target_type: "file",
      token_hash: "hashed-token",
      expires_at: "2026-10-17T20:00:00.000Z",
      revoked_at: null,
    },
    objectExists: true,
    ...overrides.state,
  };
  const handler = createProposalDemoShareHandler({
    now: () => new Date(nowValue),
    publicFunctionUrl: "https://project.supabase.co/functions/v1/proposal-demo-share",
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://swayphics.co.za" }),
    authenticateAdmin: async (request) => {
      if (request.headers.get("authorization") === "Bearer admin-token") {
        return { ok: true, userId: leadId };
      }
      if (request.headers.get("authorization") === "Bearer member-token") {
        return { ok: false, status: 403, message: "Admin required." };
      }
      return { ok: false, status: 401, message: "Authentication required." };
    },
    findProposal: async (id) => {
      calls.proposalLookups.push(id);
      return state.proposal;
    },
    insertDraftVersion: async (value) => {
      calls.versionsInserted.push(value);
      return {
        id: versionId,
        lead_id: value.lead_id,
        proposal_id: value.proposal_id,
        version_number: 1,
        title: value.title,
        asset_kind: value.asset_kind,
        file_name: value.file_name,
        entry_path: value.entry_path,
        status: "draft",
        ...overrides.createdVersion,
      };
    },
    findVersion: async () => state.version,
    privateObjectExists: async (path) => {
      calls.objectChecks.push(path);
      return state.objectExists;
    },
    publishDraftVersion: async () => ({ ...state.version, status: "published" }),
    createToken: async () => token,
    hashToken: async (value) => {
      assert.equal(value, token);
      return "hashed-token";
    },
    insertShare: async (value) => {
      calls.sharesInserted.push(value);
      return {
        id: shareId,
        demo_version_id: value.demo_version_id,
        target_type: value.target_type,
        expires_at: value.expires_at,
      };
    },
    findShare: async () => state.share,
    revokeShare: async (id, revokedBy, revokedAt) => {
      calls.sharesRevoked.push({ id, revokedBy, revokedAt });
      return { id, revoked_at: revokedAt };
    },
    findShareByTokenHash: async (hash) => {
      assert.equal(hash, "hashed-token");
      return state.share;
    },
    createSignedFileUrl: async (...args) => {
      calls.signedUrls.push(args);
      return "https://project.supabase.co/storage/v1/object/sign/private?token=short-lived";
    },
    downloadPrivateObject: async (...args) => {
      calls.downloads.push(args);
      return { data: new Blob(["<html><head></head><body><img src='/assets/logo.png'></body></html>"]) };
    },
    ...overrides.deps,
  });
  return { handler, calls, state };
}

function adminRequest(body, authorization = "Bearer admin-token") {
  return new Request("https://project.supabase.co/functions/v1/proposal-demo-share", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      origin: "https://swayphics.co.za",
    },
    body: JSON.stringify(body),
  });
}

function shareRequest(path = "") {
  return new Request(
    `https://project.supabase.co/functions/v1/proposal-demo-share/${token}/${path}`,
  );
}

test("admin-only actions reject unauthenticated and non-admin requests before data access", async () => {
  const { handler, calls } = makeHandler();
  const anonymous = await handler(adminRequest({ action: "create_version" }, ""));
  const member = await handler(adminRequest({ action: "create_version" }, "Bearer member-token"));
  assert.equal(anonymous.status, 401);
  assert.equal(member.status, 403);
  assert.equal(calls.proposalLookups.length, 0);
  assert.equal(calls.versionsInserted.length, 0);
});

test("draft versions are linked to the exact proposal lead and expose only version-scoped upload paths", async () => {
  const { handler, calls } = makeHandler();
  const response = await handler(adminRequest({
    action: "create_version",
    lead_id: leadId,
    proposal_id: proposalId,
    title: "Homepage concept",
    asset_kind: "hybrid",
    file_name: "concept.pdf",
    entry_path: "index.html",
  }));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.version.upload_file_path, `proposal-demos/${versionId}/file/concept.pdf`);
  assert.equal(payload.version.upload_site_prefix, `proposal-demos/${versionId}/site/`);
  assert.equal(calls.versionsInserted[0].created_by, leadId);
});

test("a mismatched proposal and lead cannot create a demo version", async () => {
  const { handler, calls } = makeHandler({
    state: { proposal: { id: proposalId, lead_id: otherLeadId } },
  });
  const response = await handler(adminRequest({
    action: "create_version",
    lead_id: leadId,
    proposal_id: proposalId,
    title: "Wrong lead",
    asset_kind: "file",
    file_name: "concept.pdf",
  }));
  assert.equal(response.status, 409);
  assert.equal(calls.versionsInserted.length, 0);
});

test("publishing requires every configured private target object to exist", async () => {
  const { handler, calls } = makeHandler({
    state: { objectExists: false, version: baseVersion({ status: "draft", published_at: null }) },
  });
  const response = await handler(adminRequest({
    action: "publish_version",
    demo_version_id: versionId,
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(calls.objectChecks, [`proposal-demos/${versionId}/file/concept.pdf`]);
});

test("share issuance requires an explicit future expiry and stores only the token hash", async () => {
  const { handler, calls } = makeHandler();
  const missingExpiry = await handler(adminRequest({
    action: "create_share",
    demo_version_id: versionId,
    target_type: "file",
  }));
  assert.equal(missingExpiry.status, 400);

  const response = await handler(adminRequest({
    action: "create_share",
    demo_version_id: versionId,
    target_type: "file",
    expires_at: "2026-10-17T20:00:00.000Z",
  }));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.share.share_url, `https://project.supabase.co/functions/v1/proposal-demo-share/${token}/`);
  assert.equal(calls.sharesInserted[0].token_hash, "hashed-token");
  assert.equal(JSON.stringify(calls.sharesInserted[0]).includes(token), false);
});

test("share creation rejects a target that the linked immutable version does not contain", async () => {
  const { handler, calls } = makeHandler({
    state: { version: baseVersion({ asset_kind: "static_site", file_name: null }) },
  });
  const response = await handler(adminRequest({
    action: "create_share",
    demo_version_id: versionId,
    target_type: "file",
    expires_at: "2026-10-17T20:00:00.000Z",
  }));
  assert.equal(response.status, 409);
  assert.equal(calls.sharesInserted.length, 0);
});

test("revocation is scoped to the matching version and becomes an irreversible one-time action", async () => {
  const { handler, calls } = makeHandler();
  const mismatch = await handler(adminRequest({
    action: "revoke_share",
    share_id: shareId,
    demo_version_id: otherLeadId,
  }));
  assert.equal(mismatch.status, 404);
  assert.equal(calls.sharesRevoked.length, 0);

  const response = await handler(adminRequest({
    action: "revoke_share",
    share_id: shareId,
    demo_version_id: versionId,
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.sharesRevoked[0].id, shareId);
  assert.equal(calls.sharesRevoked[0].revokedBy, leadId);
});

test("expired and revoked links fail closed without accessing private objects", async (t) => {
  for (const [name, share] of [
    ["expired", { expires_at: "2026-10-16T19:59:59.999Z", revoked_at: null }],
    ["revoked", { expires_at: "2026-10-17T20:00:00.000Z", revoked_at: "2026-10-16T19:59:00.000Z" }],
  ]) {
    await t.test(name, async () => {
      const { handler, calls } = makeHandler({
        state: { share: { ...makeHandler().state.share, ...share } },
      });
      const response = await handler(shareRequest());
      assert.equal(response.status, 404);
      assert.equal(calls.signedUrls.length, 0);
      assert.equal(calls.downloads.length, 0);
    });
  }
});

test("file shares sign only the linked private object for a short-lived attachment URL", async () => {
  const { handler, calls } = makeHandler();
  const response = await handler(shareRequest());
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://project.supabase.co/storage/v1/object/sign/private?token=short-lived");
  assert.deepEqual(calls.signedUrls[0], [
    PROPOSAL_DEMO_BUCKET,
    `proposal-demos/${versionId}/file/concept.pdf`,
    SIGNED_FILE_URL_SECONDS,
  ]);
  assert.equal(calls.downloads.length, 0);
});

test("static-site shares proxy private assets, rewrite their base path, and sandbox HTML", async () => {
  const { handler, calls } = makeHandler({
    state: {
      version: baseVersion({ asset_kind: "static_site", file_name: null }),
      share: { ...makeHandler().state.share, target_type: "static_site" },
    },
  });
  const response = await handler(shareRequest());
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(calls.downloads[0], [
    PROPOSAL_DEMO_BUCKET,
    `proposal-demos/${versionId}/site/index.html`,
  ]);
  assert.match(html, /<base href="https:\/\/project\.supabase\.co\/functions\/v1\/proposal-demo-share\/[A-Za-z0-9_-]+\/">/);
  assert.match(html, /src='https:\/\/project\.supabase\.co\/functions\/v1\/proposal-demo-share\/[A-Za-z0-9_-]+\/assets\/logo\.png'/);
  assert.match(response.headers.get("content-security-policy"), /sandbox allow-scripts/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("static-site directory routes resolve an index file within the same private version", async () => {
  const { handler, calls } = makeHandler({
    state: {
      version: baseVersion({ asset_kind: "static_site", file_name: null }),
      share: { ...makeHandler().state.share, target_type: "static_site" },
    },
  });
  const response = await handler(shareRequest("about/"));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.downloads[0], [
    PROPOSAL_DEMO_BUCKET,
    `proposal-demos/${versionId}/site/about/index.html`,
  ]);
});

test("a version whose proposal was reassigned to another lead is not shareable", async () => {
  const { handler, calls } = makeHandler({
    state: { proposal: { id: proposalId, lead_id: otherLeadId } },
  });
  const response = await handler(shareRequest());
  assert.equal(response.status, 404);
  assert.equal(calls.signedUrls.length, 0);
  assert.equal(calls.downloads.length, 0);
});

test("asset traversal and mismatched share target cannot read private storage", async () => {
  const { handler, calls } = makeHandler({
    state: { share: { ...makeHandler().state.share, target_type: "static_site" } },
  });
  const traversal = await handler(shareRequest("..%2Fprivate.txt"));
  assert.equal(traversal.status, 400);
  assert.equal(calls.downloads.length, 0);

  const wrongTarget = makeHandler({
    state: {
      version: baseVersion({ asset_kind: "file", entry_path: null }),
      share: { ...makeHandler().state.share, target_type: "static_site" },
    },
  });
  const response = await wrongTarget.handler(shareRequest());
  assert.equal(response.status, 404);
  assert.equal(wrongTarget.calls.downloads.length, 0);
  assert.equal(wrongTarget.calls.signedUrls.length, 0);
});

test("migration keeps the demo bucket private, scopes uploads to drafts, and defines no file update/delete policy", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261017041112_swayphics_proposal_demo_lifecycle.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'swayphics-proposal-demos'[\s\S]{0,120}'swayphics-proposal-demos'[\s\S]{0,80}false/);
  assert.match(migration, /version\.status = 'draft'/);
  assert.match(migration, /version\.id::text = split_part\(name, '\/', 2\)/);
  assert.doesNotMatch(migration, /on storage\.objects\s+for update/i);
  assert.doesNotMatch(migration, /on storage\.objects\s+for delete/i);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /references public\.leads\(id\) on delete restrict/i);
  assert.match(migration, /references public\.lead_proposals\(id\) on delete restrict/i);
  assert.match(migration, /its contents are immutable/i);
});
