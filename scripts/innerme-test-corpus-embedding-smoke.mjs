import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const SUPABASE_URL = "https://ofqofhnlzbouclvvrmzd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p4UqpaLvEx_93XJSWvzo6Q_loju0xzW";
const RESULT_PATH = "innerme-test-corpus-embedding-smoke-result.json";
const SEED_CONFIRMATION = String(process.env.CONFIRM_TEST_ONLY_CORPUS || "").toLowerCase() === "true";
const RUN_CHAT_CHECKS = String(process.env.RUN_CHAT_CHECKS || "false").toLowerCase() === "true";

const sources = [
  {
    slug: "innerme-test-source-retrieval-contract",
    url: "https://github.com/NtandoSway7929/SWA/blob/eff74f40549838491cb23dfb58989fc15b83dbad/supabase/migrations/20261015224500_innerme_knowledge_retrieval_schema_baseline.sql",
  },
  {
    slug: "innerme-test-source-retrieval-runbook",
    url: "https://github.com/NtandoSway7929/SWA/blob/eff74f40549838491cb23dfb58989fc15b83dbad/docs/innerme-semantic-retrieval-e2e-smoke-test.md",
  },
];

const records = [
  {
    slug: "innerme-test-retrieval-eligibility-contract-20261019",
    title: "InnerMe verified knowledge retrieval eligibility contract",
    domain: "innerme-test-architecture",
    knowledge_type: "framework",
    statement: "The InnerMe match_innerme_knowledge retrieval RPC returns only knowledge records whose status is active, verification_status is verified, review_after is in the future, embedding_status is ready, and an embedding vector is present. Optional filters can narrow results by domain, jurisdiction, and knowledge type; the similarity must meet the requested threshold.",
    application: "Use this contract when debugging zero-match retrieval. Check each eligibility gate and distinguish a retrieval execution error from a successful query with no matching records.",
    constraints: "Isolated test-only internal code reference. It is not business, tax, legal, or financial guidance.",
    do_not_use_when: "Do not cite this record as public product documentation or as evidence of production state. It describes a versioned repository artifact only.",
    source_slug: sources[0].slug,
  },
  {
    slug: "innerme-test-retrieval-only-runbook-20261019",
    title: "InnerMe retrieval-only semantic regression contract",
    domain: "innerme-test-validation",
    knowledge_type: "framework",
    statement: "The isolated InnerMe semantic retrieval regression suite has a retrieval-only mode that evaluates twenty-four retrieval and eligibility cases, intentionally skips four normal-chat grounding cases, makes zero Gemini normal-chat requests, and removes its six temporary synthetic fixtures after the run.",
    application: "Use this statement to interpret the isolated workflow result. A retrieval-only pass tests its fixed synthetic corpus and does not establish real-corpus chat grounding or production readiness.",
    constraints: "Isolated test-only operational reference derived from the versioned regression test documentation.",
    do_not_use_when: "Do not describe a retrieval-only pass as a successful normal-chat grounding test or production validation.",
    source_slug: sources[1].slug,
  },
];

function assertTestOnlyConfiguration() {
  if (!SEED_CONFIRMATION) {
    throw new Error("Safety stop: confirm_test_only_corpus must be true before test records can be created.");
  }
  if (RUN_CHAT_CHECKS) {
    throw new Error("Safety stop: corpus embedding smoke must run with normal-chat checks disabled.");
  }
  for (const name of ["INNERME_TEST_ADMIN_EMAIL", "INNERME_TEST_ADMIN_PASSWORD"]) {
    if (!process.env[name]) throw new Error("Missing required isolated test-project secret: " + name);
  }
}

function authHeaders(accessToken) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + accessToken,
    "Content-Type": "application/json",
  };
}

async function readJson(response, context) {
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(context + " returned non-JSON HTTP " + response.status + ".");
  }
  if (!response.ok) {
    const detail = payload && (payload.message || payload.error || payload.hint);
    throw new Error(context + " failed with HTTP " + response.status + (detail ? ": " + String(detail).slice(0, 300) : "."));
  }
  return payload;
}

async function apiRequest(accessToken, url, options = {}, context = "Supabase test request") {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(accessToken), ...(options.headers || {}) },
  });
  return await readJson(response, context);
}

async function getBySlugs(accessToken, table, slugs, columns) {
  const params = new URLSearchParams({
    select: columns,
    slug: "in.(" + slugs.join(",") + ")",
  });
  return await apiRequest(
    accessToken,
    SUPABASE_URL + "/rest/v1/" + table + "?" + params.toString(),
    { method: "GET" },
    "Read test-only " + table,
  );
}

async function cleanupCreatedKnowledge(accessToken, createdIds) {
  if (!createdIds.length) return;
  const params = new URLSearchParams({
    id: "in.(" + createdIds.join(",") + ")",
  });
  const response = await fetch(SUPABASE_URL + "/rest/v1/innerme_knowledge?" + params.toString(), {
    method: "DELETE",
    headers: {
      ...authHeaders(accessToken),
      Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error("Failed to remove temporary test-only knowledge rows (HTTP " + response.status + "): " + text.slice(0, 300));
  }
}

async function main() {
  assertTestOnlyConfiguration();

  let accessToken = "";
  const createdIds = [];
  const result = {
    project_ref: "ofqofhnlzbouclvvrmzd",
    mode: "isolated-test-only-embedding-and-retrieval",
    normal_chat_requests: 0,
    results: [],
    cleanup: { attempted: false, passed: false, remaining_knowledge_rows: null },
  };

  try {
    const loginResponse = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.INNERME_TEST_ADMIN_EMAIL,
        password: process.env.INNERME_TEST_ADMIN_PASSWORD,
      }),
    });
    const login = await readJson(loginResponse, "Isolated test-admin sign-in");
    assert.equal(typeof login.access_token, "string", "Isolated sign-in must return an access token.");
    accessToken = login.access_token;
    process.stdout.write("::add-mask::" + accessToken + "\n");

    const sourceRows = await getBySlugs(accessToken, "innerme_knowledge_sources", sources.map((s) => s.slug), "id,slug,status,verification_status,url");
    assert.equal(sourceRows.length, sources.length, "Both reviewed test-only source records must already exist.");
    for (const expected of sources) {
      const source = sourceRows.find((row) => row.slug === expected.slug);
      assert.ok(source, "Missing test-only source " + expected.slug);
      assert.equal(source.status, "active", "Test source must be active.");
      assert.equal(source.verification_status, "verified", "Test source must be marked verified after source review.");
      assert.equal(source.url, expected.url, "Test source URL must match the reviewed repository source.");
    }

    const existing = await getBySlugs(accessToken, "innerme_knowledge", records.map((r) => r.slug), "id,slug");
    assert.equal(existing.length, 0, "A matching test-only record already exists. Refusing to overwrite or delete pre-existing data.");

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sourceBySlug = new Map(sourceRows.map((source) => [source.slug, source]));
    const payload = records.map((record) => {
      const source = sourceBySlug.get(record.source_slug);
      assert.ok(source, "Missing source link for " + record.slug);
      return {
        source_id: source.id,
        slug: record.slug,
        title: record.title,
        domain: record.domain,
        knowledge_type: record.knowledge_type,
        statement: record.statement,
        application: record.application,
        constraints: record.constraints,
        do_not_use_when: record.do_not_use_when,
        evidence_level: "internal",
        confidence: "high",
        jurisdiction: "Global",
        tags: ["test-only", "source-backed", "innerme-qa"],
        priority: 90,
        status: "active",
        last_verified_at: now.toISOString(),
        review_after: future,
        verification_status: "verified",
        verification_method: "internal_review",
        verification_notes: "TEST ONLY: this source-backed fixture was checked against the linked repository file to validate embedding and retrieval in the isolated project. This is not a production verification record.",
        verified_source_url: source.url,
        embedding_status: "pending",
      };
    });

    const inserted = await apiRequest(
      accessToken,
      SUPABASE_URL + "/rest/v1/innerme_knowledge",
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) },
      "Create temporary source-backed test corpus",
    );
    assert.ok(Array.isArray(inserted) && inserted.length === records.length, "Both temporary test records must be created.");
    inserted.forEach((row) => {
      assert.ok(row.id && row.slug, "Inserted test row must have an id and slug.");
      createdIds.push(row.id);
    });

    await apiRequest(
      accessToken,
      SUPABASE_URL + "/functions/v1/swayphics-ai",
      {
        method: "POST",
        body: JSON.stringify({ action: "embed_knowledge", knowledge_ids: createdIds }),
      },
      "Generate isolated gte-small embeddings",
    );

    const statusRows = await getBySlugs(accessToken, "innerme_knowledge", records.map((r) => r.slug), "id,slug,source_id,verification_status,embedding_status,embedded_at");
    assert.equal(statusRows.length, records.length, "Both test rows must remain available after embedding.");
    for (const row of statusRows) {
      assert.equal(row.verification_status, "verified", row.slug + " must meet the test retrieval verification gate.");
      assert.equal(row.embedding_status, "ready", row.slug + " must be indexed and ready.");
      assert.ok(row.embedded_at, row.slug + " must have an embedding timestamp.");
    }

    for (const record of records) {
      const row = statusRows.find((item) => item.slug === record.slug);
      const query = record.title + "\n" + record.statement;
      const search = await apiRequest(
        accessToken,
        SUPABASE_URL + "/functions/v1/swayphics-ai",
        {
          method: "POST",
          body: JSON.stringify({
            action: "search_knowledge",
            query,
            match_threshold: 0.8,
            match_count: 10,
          }),
        },
        "Search temporary source-backed test knowledge",
      );
      const matches = Array.isArray(search.matches) ? search.matches : [];
      const found = matches.find((match) => String(match.id || "") === String(row.id));
      assert.ok(found, "The exact test record was not returned by semantic retrieval: " + record.slug);
      assert.ok(Number(found.similarity) >= 0.8, "Retrieved test record did not meet the 0.80 similarity threshold: " + record.slug);
      assert.equal(found.source_url, sources.find((source) => source.slug === record.source_slug).url, "Retrieved evidence must retain its source URL.");

      result.results.push({
        slug: record.slug,
        title: record.title,
        similarity: Number(found.similarity),
        source_url: found.source_url,
        verification_status: row.verification_status,
        embedding_status: row.embedding_status,
        retrieved: true,
      });
    }
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    if (accessToken) {
      result.cleanup.attempted = createdIds.length > 0;
      try {
        await cleanupCreatedKnowledge(accessToken, createdIds);
        const leftovers = await getBySlugs(accessToken, "innerme_knowledge", records.map((r) => r.slug), "id,slug");
        result.cleanup.remaining_knowledge_rows = leftovers.length;
        result.cleanup.passed = leftovers.length === 0;
        if (leftovers.length !== 0) {
          throw new Error("Temporary corpus cleanup left " + leftovers.length + " test-only knowledge row(s).");
        }
      } catch (error) {
        result.cleanup.error = error instanceof Error ? error.message : String(error);
        result.status = "failed";
        process.exitCode = 1;
      }
    }
    result.finished_at = new Date().toISOString();
    await writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = [
        "## Source-backed test-only corpus smoke",
        "",
        "**Status:** " + String(result.status || "failed").toUpperCase(),
        "",
        "- Isolated project: `ofqofhnlzbouclvvrmzd`",
        "- Normal-chat/Gemini requests: 0",
        "- Temporary records created: " + createdIds.length,
        "- Cleanup verified: " + String(result.cleanup.passed),
        "- Remaining knowledge rows with test slugs: " + String(result.cleanup.remaining_knowledge_rows),
        "",
        "| Test record | Retrieved | Similarity | Source URL |",
        "|---|---:|---:|---|",
        ...result.results.map((item) => "| " + item.slug + " | " + item.retrieved + " | " + item.similarity.toFixed(4) + " | " + item.source_url + " |"),
      ];
      if (result.error) lines.push("", "**Failure:** " + result.error);
      if (result.cleanup.error) lines.push("", "**Cleanup failure:** " + result.cleanup.error);
      await import("node:fs/promises").then(({ appendFile }) => appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", "utf8"));
    }
    process.stdout.write("INNERME_TEST_CORPUS_SMOKE_STATUS=" + String(result.status || "failed") + "\n");
    process.stdout.write("INNERME_TEST_CORPUS_CLEANUP_PASSED=" + String(result.cleanup.passed) + "\n");
  }
}

await main();
