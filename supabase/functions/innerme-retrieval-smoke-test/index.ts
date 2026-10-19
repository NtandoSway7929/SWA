import { createClient } from "npm:@supabase/supabase-js@2";
import { extractBearerToken } from "./auth-header.mjs";

// TEST-ONLY: this endpoint must never be deployed to production.
// It hard-refuses every Supabase project except the isolated project below.
const ISOLATED_PROJECT_REF = "ofqofhnlzbouclvvrmzd";
const SUITE_ID = "innerme_semantic_retrieval_regression";
const BASELINE_VERSION = "1.2.0";
const ALLOWED_CHAT_CASE_IDS: readonly string[] = [
  "normal_chat_invoice_grounding",
  "normal_chat_appointment_grounding",
  "normal_chat_dispatch_grounding",
  "normal_chat_irrelevant_invoice_exclusion",
];
const EMBEDDING_MODEL = "gte-small";
const EMBEDDING_DIMENSIONS = 384;

const REQUIRED_FIXTURE_KEYS = [
  "invoice",
  "appointment",
  "dispatch",
  "stale",
  "unverified",
  "expired_review",
] as const;

const REQUIRED_TESTS: Record<string, { type: string; fixture_key: string; expected_match: boolean; retrieval_scope?: "fixture" | "corpus"; expected_fixture_keys?: string[] }> = {
  semantic_invoice_match: {"type":"retrieval_positive","fixture_key":"invoice","expected_match":true},
  semantic_appointment_match: {"type":"retrieval_positive","fixture_key":"appointment","expected_match":true},
  semantic_dispatch_match: {"type":"retrieval_positive","fixture_key":"dispatch","expected_match":true},
  semantic_irrelevant_query_excluded: {"type":"retrieval_negative","fixture_key":"invoice","expected_match":false},
  semantic_irrelevant_cooking_excluded: {"type":"retrieval_negative","fixture_key":"invoice","expected_match":false},
  semantic_irrelevant_algorithm_excluded: {"type":"retrieval_negative","fixture_key":"invoice","expected_match":false},
  semantic_stale_knowledge_excluded: {"type":"eligibility_exclusion","fixture_key":"stale","expected_match":false},
  semantic_unverified_knowledge_excluded: {"type":"eligibility_exclusion","fixture_key":"unverified","expected_match":false},
  semantic_expired_review_excluded: {"type":"eligibility_exclusion","fixture_key":"expired_review","expected_match":false},
  normal_chat_invoice_grounding: {"type":"chat_grounding","fixture_key":"invoice","expected_match":true},
  normal_chat_appointment_grounding: {"type":"chat_grounding","fixture_key":"appointment","expected_match":true},
  normal_chat_dispatch_grounding: {"type":"chat_grounding","fixture_key":"dispatch","expected_match":true},
  normal_chat_irrelevant_invoice_exclusion: {"type":"chat_exclusion","fixture_key":"invoice","expected_match":false},
  corpus_invoice_paraphrase_1: {"type":"corpus_retrieval_positive","fixture_key":"invoice","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["invoice"]},
  corpus_invoice_paraphrase_2: {"type":"corpus_retrieval_positive","fixture_key":"invoice","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["invoice"]},
  corpus_invoice_paraphrase_3: {"type":"corpus_retrieval_positive","fixture_key":"invoice","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["invoice"]},
  corpus_appointment_paraphrase_1: {"type":"corpus_retrieval_positive","fixture_key":"appointment","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["appointment"]},
  corpus_appointment_paraphrase_2: {"type":"corpus_retrieval_positive","fixture_key":"appointment","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["appointment"]},
  corpus_appointment_paraphrase_3: {"type":"corpus_retrieval_positive","fixture_key":"appointment","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["appointment"]},
  corpus_dispatch_paraphrase_1: {"type":"corpus_retrieval_positive","fixture_key":"dispatch","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["dispatch"]},
  corpus_dispatch_paraphrase_2: {"type":"corpus_retrieval_positive","fixture_key":"dispatch","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["dispatch"]},
  corpus_dispatch_paraphrase_3: {"type":"corpus_retrieval_positive","fixture_key":"dispatch","expected_match":true,"retrieval_scope":"corpus","expected_fixture_keys":["dispatch"]},
  corpus_irrelevant_lunar_phases: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
  corpus_irrelevant_guitar_tuning: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
  corpus_irrelevant_tomato_soil: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
  corpus_irrelevant_ocean_tides: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
  corpus_irrelevant_mountain_pressure: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
  corpus_irrelevant_chess_opening: {"type":"corpus_retrieval_negative","fixture_key":"invoice","expected_match":false,"retrieval_scope":"corpus","expected_fixture_keys":[]},
};

const REQUIRED_FIXTURE_POLICY: Record<string, { status: string; verification_status: string; review_window: string }> = {
  invoice: { status: "active", verification_status: "verified", review_window: "future" },
  appointment: { status: "active", verification_status: "verified", review_window: "future" },
  dispatch: { status: "active", verification_status: "verified", review_window: "future" },
  stale: { status: "active", verification_status: "stale", review_window: "future" },
  unverified: { status: "active", verification_status: "unverified", review_window: "future" },
  expired_review: { status: "active", verification_status: "verified", review_window: "expired" },
};

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options?: { mean_pool?: boolean; normalize?: boolean }): Promise<Iterable<number>>;
    };
  };
};

type RegressionCaseResult = {
  id: string;
  type: string;
  status: "passed" | "failed" | "inconclusive" | "not_run" | "skipped";
  fixture_key: string;
  expected_match: boolean;
  observed_match?: boolean;
  similarity?: number | null;
  knowledge_match?: boolean;
  answer_contains_expected_phrase?: boolean;
  expected_fixture_keys?: string[];
  observed_fixture_keys?: string[];
  false_positive_fixture_keys?: string[];
  false_negative_fixture_keys?: string[];
  unmapped_match_count?: number;
  retrieved_matches?: Array<{ fixture_key: string | null; similarity: number | null; rank: number }>;
  ranking_diagnostics?: { method: string; max_similarity_delta: number; candidate_count: number; selected_count: number; excluded_matches: Array<{ fixture_key: string | null; similarity: number | null; rank: number }> };
  skip_reason?: string;
  error?: string;
};

class ExecutionFailure extends Error {
  stage: string;
  httpStatus?: number;

  constructor(stage: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "ExecutionFailure";
    this.stage = stage;
    this.httpStatus = httpStatus;
  }
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateBaseline(value: unknown): { baseline: any | null; error: string | null } {
  if (!value || typeof value !== "object") {
    return { baseline: null, error: "The regression baseline must be a JSON object." };
  }
  const baseline = value as Record<string, any>;
  if (baseline.run_chat_checks !== undefined && typeof baseline.run_chat_checks !== "boolean") {
    return { baseline: null, error: "run_chat_checks must be a boolean when supplied." };
  }
  if (
    baseline.run_chat_case_id !== undefined &&
    (!isNonEmptyString(baseline.run_chat_case_id) ||
      (baseline.run_chat_case_id !== "all" && !ALLOWED_CHAT_CASE_IDS.includes(baseline.run_chat_case_id)))
  ) {
    return { baseline: null, error: "run_chat_case_id must be one of the pinned normal-chat case IDs or 'all'." };
  }
  if (baseline.suite_id !== SUITE_ID || baseline.baseline_version !== BASELINE_VERSION) {
    return { baseline: null, error: "The regression suite identifier or version is not supported by this helper." };
  }
  if (
    baseline.embedding_model !== EMBEDDING_MODEL ||
    baseline.embedding_dimensions !== EMBEDDING_DIMENSIONS ||
    baseline.retrieval_similarity_threshold !== 0.8
  ) {
    return { baseline: null, error: "The regression baseline changed a pinned model, dimension, or retrieval threshold." };
  }
  const calibration = baseline.threshold_calibration as Record<string, any> | undefined;
  if (
    !calibration ||
    calibration.source_run_id !== "38839420386" ||
    calibration.source_attempt !== 2 ||
    calibration.case_id !== "semantic_irrelevant_query_excluded" ||
    calibration.observed_similarity !== 0.717157678773543 ||
    calibration.lowest_positive_similarity !== 0.900932317916614 ||
    calibration.chosen_threshold !== 0.8
  ) {
    return { baseline: null, error: "Threshold calibration evidence does not match the pinned calibration record." };
  }

  if (!Array.isArray(baseline.fixtures) || !Array.isArray(baseline.tests)) {
    return { baseline: null, error: "The regression baseline must include fixture and test arrays." };
  }

  const fixtures = new Map<string, any>();
  for (const fixture of baseline.fixtures) {
    if (!fixture || !isNonEmptyString(fixture.key) || fixtures.has(fixture.key)) {
      return { baseline: null, error: "Fixture keys must be non-empty and unique." };
    }
    fixtures.set(fixture.key, fixture);
  }
  if (
    fixtures.size !== REQUIRED_FIXTURE_KEYS.length ||
    REQUIRED_FIXTURE_KEYS.some((key) => !fixtures.has(key))
  ) {
    return { baseline: null, error: "The baseline must include the six pinned fixture keys." };
  }

  for (const key of REQUIRED_FIXTURE_KEYS) {
    const fixture = fixtures.get(key);
    const policy = REQUIRED_FIXTURE_POLICY[key];
    if (
      !isNonEmptyString(fixture.title) ||
      !isNonEmptyString(fixture.domain) ||
      !isNonEmptyString(fixture.knowledge_type) ||
      !isNonEmptyString(fixture.statement) ||
      !isNonEmptyString(fixture.canary_phrase) ||
      fixture.status !== policy.status ||
      fixture.verification_status !== policy.verification_status ||
      fixture.review_window !== policy.review_window
    ) {
      return { baseline: null, error: "Fixture metadata does not match the pinned eligibility expectations for " + key + "." };
    }
  }

  const tests = new Map<string, any>();
  for (const test of baseline.tests) {
    if (!test || !isNonEmptyString(test.id) || tests.has(test.id)) {
      return { baseline: null, error: "Test IDs must be non-empty and unique." };
    }
    tests.set(test.id, test);
  }
  const requiredIds = Object.keys(REQUIRED_TESTS);
  if (tests.size !== requiredIds.length || requiredIds.some((id) => !tests.has(id))) {
    return { baseline: null, error: "The baseline must include all " + requiredIds.length + " pinned regression cases." };
  }

  for (const [id, pinned] of Object.entries(REQUIRED_TESTS)) {
    const test = tests.get(id);
    if (
      test.type !== pinned.type ||
      test.fixture_key !== pinned.fixture_key ||
      test.expected_match !== pinned.expected_match ||
      (test.retrieval_scope || "fixture") !== (pinned.retrieval_scope || "fixture") ||
      (pinned.retrieval_scope === "corpus" && (!Array.isArray(test.expected_fixture_keys) || JSON.stringify(test.expected_fixture_keys) !== JSON.stringify(pinned.expected_fixture_keys))) ||
      !isNonEmptyString(test.query) ||
      test.query.length > 1200
    ) {
      return { baseline: null, error: "The expectation contract is invalid for regression case " + id + "." };
    }
  }

  const domainSet = new Set(baseline.fixtures.map((fixture: any) => fixture.domain));
  if (domainSet.size !== baseline.fixtures.length) {
    return { baseline: null, error: "Every synthetic fixture must use its own unique domain filter." };
  }

  return { baseline, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST is required." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    "";
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    "";

  let projectHost = "";
  try {
    projectHost = new URL(supabaseUrl).hostname;
  } catch {
    return jsonResponse({ ok: false, error: "Supabase URL is not configured." }, 500);
  }

  if (projectHost !== ISOLATED_PROJECT_REF + ".supabase.co") {
    return jsonResponse({
      ok: false,
      error: "Safety stop: this regression suite only runs in the isolated InnerMe test project.",
    }, 403);
  }

  if (!serviceKey || !anonKey) {
    return jsonResponse({ ok: false, error: "Required server-side Supabase keys are unavailable." }, 500);
  }

  const authorization = req.headers.get("authorization") || "";
  const accessToken = extractBearerToken(authorization);
  if (!accessToken) {
    return jsonResponse({ ok: false, error: "A signed-in isolated test-admin token is required." }, 401);
  }

  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await adminDb.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) {
    return jsonResponse({ ok: false, error: "The isolated test-admin session is invalid." }, 401);
  }

  const { data: adminRow, error: adminError } = await adminDb
    .from("admin_users")
    .select("user_id, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (adminError || !adminRow) {
    return jsonResponse({ ok: false, error: "An active administrator in the isolated test project is required." }, 403);
  }

  let submittedBaseline: unknown;
  try {
    submittedBaseline = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "The regression baseline request body must be valid JSON." }, 400);
  }
  const validation = validateBaseline(submittedBaseline);
  if (validation.error || !validation.baseline) {
    return jsonResponse({ ok: false, error: validation.error || "The regression baseline is invalid." }, 400);
  }
  const baseline = validation.baseline;
  const runChatChecks = baseline.run_chat_checks !== false;
  // Safer default: one focused grounding case. The full four-case suite is explicit.
  const runChatCaseId = runChatChecks
    ? (isNonEmptyString(baseline.run_chat_case_id) ? baseline.run_chat_case_id : "normal_chat_invoice_grounding")
    : null;

  // Provider preflight is only required when normal-chat calls are included.
  if (runChatChecks && !Deno.env.get("GEMINI_API_KEY")) {
    return jsonResponse({
      ok: false,
      status: "inconclusive",
      suite_id: SUITE_ID,
      baseline_version: BASELINE_VERSION,
      failure: {
        stage: "provider_preflight",
        kind: "execution",
        message: "GEMINI_API_KEY is not configured in the isolated test project; no fixtures or chat requests were made.",
      },
      provider_chat_requests_attempted: 0,
    }, 503);
  }

  // Reserve two Gemini attempts per selected chat case: the primary attempt and
  // one possible guarded fallback. Check quota before seeding any fixtures.
  // This is advisory; reserveInnerMeProviderQuota remains the atomic authority.
  if (runChatChecks) {
    const utcQuotaDate = new Date().toISOString().slice(0, 10);
    const { data: quotaRow, error: quotaReadError } = await adminDb
      .from("innerme_provider_quota_daily")
      .select("request_count")
      .eq("provider", "gemini")
      .eq("quota_date", utcQuotaDate)
      .maybeSingle();

    if (quotaReadError) {
      return jsonResponse({
        ok: false,
        status: "inconclusive",
        suite_id: SUITE_ID,
        baseline_version: BASELINE_VERSION,
        failure: {
          stage: "provider_quota_preflight",
          kind: "execution",
          message: "Could not verify the isolated Gemini UTC quota before fixture setup; no fixtures or chat requests were made.",
        },
        provider_chat_requests_attempted: 0,
        quota_preflight: { passed: false, quota_date_utc: utcQuotaDate, reason: "counter_unavailable" },
      }, 503);
    }

    const used = quotaRow == null ? 0 : Number(quotaRow.request_count);
    const dailyLimit = 40;
    const selectedChatCaseCount = runChatCaseId === "all" ? ALLOWED_CHAT_CASE_IDS.length : 1;
    const minimumRequiredRequests = selectedChatCaseCount * 2;
    if (!Number.isSafeInteger(used) || used < 0 || used > dailyLimit) {
      return jsonResponse({
        ok: false,
        status: "inconclusive",
        suite_id: SUITE_ID,
        baseline_version: BASELINE_VERSION,
        failure: {
          stage: "provider_quota_preflight",
          kind: "execution",
          message: "The isolated Gemini quota counter returned an invalid value; failing closed before fixture setup.",
        },
        provider_chat_requests_attempted: 0,
        quota_preflight: { passed: false, quota_date_utc: utcQuotaDate, reason: "counter_invalid" },
      }, 503);
    }

    const remainingBudget = dailyLimit - used;
    if (remainingBudget < minimumRequiredRequests) {
      return jsonResponse({
        ok: false,
        status: "inconclusive",
        suite_id: SUITE_ID,
        baseline_version: BASELINE_VERSION,
        failure: {
          stage: "provider_quota_preflight",
          kind: "execution",
          message: "The selected chat mode needs at least " + minimumRequiredRequests + " remaining Gemini request reservations to cover the selected case(s) and possible guarded fallback attempts. Current usage is " + used + "/" + dailyLimit + " for UTC date " + utcQuotaDate + "; no fixtures or chat requests were made. Run retrieval-only mode or retry after the next UTC reset.",
          http_status: 429,
        },
        provider_chat_requests_attempted: 0,
        quota_preflight: {
          passed: false,
          quota_date_utc: utcQuotaDate,
          used,
          daily_limit: dailyLimit,
          remaining: remainingBudget,
          minimum_required: minimumRequiredRequests,
        },
      }, 429);
    }
  }

  const authenticatedDb = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });

  const runId = crypto.randomUUID().replaceAll("-", "");
  const startedAt = new Date().toISOString();
  const fixtureSlugs = new Map<string, string>();
  const fixtureIds = new Map<string, string>();
  const caseResults: RegressionCaseResult[] = [];
  let executionFailure: { stage: string; kind: string; message: string; http_status?: number } | null = null;
  let cleanupError: string | null = null;
  let providerChatRequestsAttempted = 0;
  let embeddingDimensions = 0;

  for (const fixture of baseline.fixtures) {
    fixtureSlugs.set(fixture.key, "__innerme_semantic_regression_" + runId + "_" + fixture.key + "__");
  }

  function recordNotRun(test: any, reason: string) {
    caseResults.push({
      id: test.id,
      type: test.type,
      status: "not_run",
      fixture_key: test.fixture_key,
      expected_match: test.expected_match,
      ...(Array.isArray(test.expected_fixture_keys) ? { expected_fixture_keys: test.expected_fixture_keys } : {}),
      error: reason.slice(0, 300),
    });
  }

  try {
    // Seed only run-unique synthetic rows; all are automatically removed below.
    for (const fixture of baseline.fixtures) {
      const reviewAfter = fixture.review_window === "expired"
        ? new Date(Date.now() - 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { data: inserted, error: insertError } = await authenticatedDb
        .from("innerme_knowledge")
        .insert({
          slug: fixtureSlugs.get(fixture.key),
          title: fixture.title,
          domain: fixture.domain + "-" + runId,
          knowledge_type: fixture.knowledge_type,
          statement: fixture.statement,
          application: fixture.application || "Synthetic regression fixture; never use as business advice.",
          constraints: "Isolated test-only data; not a real business fact.",
          do_not_use_when: "Never apply synthetic regression data to real business decisions.",
          evidence_level: "internal",
          confidence: "high",
          jurisdiction: "Global",
          tags: ["synthetic", "semantic-regression", fixture.key],
          priority: 100,
          status: fixture.status,
          last_verified_at: new Date().toISOString(),
          review_after: reviewAfter,
          created_by: user.id,
          verification_status: fixture.verification_status,
          verification_method: "isolated_semantic_retrieval_regression_v" + BASELINE_VERSION,
          verification_notes: "Synthetic fixture automatically removed after regression run.",
          embedding_status: "pending",
        })
        .select("id, embedding_text")
        .single();

      if (insertError || !inserted) {
        throw new ExecutionFailure("fixture_insert", "Synthetic fixture insert failed: " + (insertError?.message || "no row returned"));
      }
      fixtureIds.set(fixture.key, inserted.id);

      const embeddingText = String(inserted.embedding_text || "").trim();
      if (!embeddingText.includes(fixture.canary_phrase)) {
        throw new ExecutionFailure("embedding_text_trigger", "Embedding-text trigger omitted the canary phrase for fixture " + fixture.key + ".");
      }

      let documentEmbedding: number[];
      try {
        const model = new Supabase.ai.Session(EMBEDDING_MODEL);
        documentEmbedding = Array.from(await model.run(embeddingText, { mean_pool: true, normalize: true }) as Iterable<number>);
      } catch (error) {
        throw new ExecutionFailure("document_embedding", "gte-small document embedding failed for fixture " + fixture.key + ": " + safeError(error));
      }
      embeddingDimensions = documentEmbedding.length;
      if (documentEmbedding.length !== EMBEDDING_DIMENSIONS) {
        throw new ExecutionFailure("document_embedding", "Expected 384 document-embedding dimensions for " + fixture.key + "; received " + documentEmbedding.length + ".");
      }

      const { data: updated, error: updateError } = await authenticatedDb
        .from("innerme_knowledge")
        .update({
          embedding: JSON.stringify(documentEmbedding),
          embedding_model: EMBEDDING_MODEL,
          embedding_version: 1,
          embedding_status: "ready",
          embedding_error: null,
          embedded_at: new Date().toISOString(),
        })
        .eq("id", inserted.id)
        .select("id")
        .maybeSingle();
      if (updateError || !updated) {
        throw new ExecutionFailure("fixture_embedding_update", "Could not save the synthetic embedding for " + fixture.key + ": " + (updateError?.message || "no row updated"));
      }
    }

    // Retrieval positive, irrelevant-query negative and eligibility exclusion cases.
    for (const test of baseline.tests.filter((item: any) => item.type !== "chat_grounding" && item.type !== "chat_exclusion")) {
      if (executionFailure) {
        recordNotRun(test, "Suite execution stopped after " + executionFailure.stage + ".");
        continue;
      }
      const fixture = baseline.fixtures.find((item: any) => item.key === test.fixture_key);
      const targetSlug = fixtureSlugs.get(test.fixture_key);
      try {
        const searchResponse = await fetch(supabaseUrl + "/functions/v1/swayphics-ai", {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "search_knowledge",
            query: test.query,
            match_threshold: baseline.retrieval_similarity_threshold,
            match_count: 6,
            ...(test.retrieval_scope === "corpus" ? {} : { filter_domain: fixture.domain + "-" + runId }),
            filter_jurisdiction: "Global",
            filter_knowledge_type: fixture.knowledge_type,
          }),
        });
        const searchPayload = await searchResponse.json().catch(() => null);
        if (!searchResponse.ok || !searchPayload || searchPayload.ok !== true || searchPayload.read_only !== true || searchPayload.embedding_dimensions !== EMBEDDING_DIMENSIONS) {
          const message = "search_knowledge execution failed with HTTP " + searchResponse.status + ": " + String(searchPayload?.error || "invalid retrieval response").slice(0, 250);
          executionFailure = { stage: test.id, kind: "execution", message, http_status: searchResponse.status };
          caseResults.push({
            id: test.id,
            type: test.type,
            status: "inconclusive",
            fixture_key: test.fixture_key,
            expected_match: test.expected_match,
            error: message,
          });
          continue;
        }

        const matches: Array<Record<string, unknown>> = Array.isArray(searchPayload.matches)
          ? searchPayload.matches as Array<Record<string, unknown>>
          : [];
        const match = matches.find((item: Record<string, unknown>) => item?.slug === targetSlug);
        const observedMatch = Boolean(match);
        const similarity = match ? Number(match.similarity) : null;
        const isCorpusWide = test.retrieval_scope === "corpus";
        const slugToFixtureKey = new Map<string, string>();
        for (const [key, slug] of fixtureSlugs.entries()) slugToFixtureKey.set(slug, key);
        const retrievedMatches = matches.map((item, index) => ({
          fixture_key: slugToFixtureKey.get(String(item?.slug || "")) || null,
          similarity: Number.isFinite(Number(item?.similarity)) ? Number(item.similarity) : null,
          rank: index + 1,
        }));
        const rankingPayload = searchPayload.retrieval_ranking && typeof searchPayload.retrieval_ranking === "object"
          ? searchPayload.retrieval_ranking as Record<string, unknown>
          : null;
        const excludedRaw = rankingPayload && Array.isArray(rankingPayload.excluded_matches)
          ? rankingPayload.excluded_matches as Array<Record<string, unknown>>
          : [];
        const excludedByGap = excludedRaw.map((item) => ({
          fixture_key: slugToFixtureKey.get(String(item?.slug || "")) || null,
          similarity: Number.isFinite(Number(item?.similarity)) ? Number(item.similarity) : null,
          rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : 0,
        }));
        const rankingDiagnostics = rankingPayload ? {
          method: String(rankingPayload.method || "unknown"),
          max_similarity_delta: Number(rankingPayload.max_similarity_delta),
          candidate_count: Number(rankingPayload.candidate_count || 0),
          selected_count: Number(rankingPayload.selected_count || 0),
          excluded_matches: excludedByGap,
        } : undefined;
        const observedFixtureKeys: string[] = Array.from(new Set(
          retrievedMatches
            .map((item) => item.fixture_key)
            .filter((key): key is string => typeof key === "string"),
        )).sort();
        const expectedFixtureKeys = isCorpusWide ? [...test.expected_fixture_keys].sort() : [];
        const unmappedMatchCount = isCorpusWide
          ? matches.filter((item) => !slugToFixtureKey.has(String(item?.slug || ""))).length
          : 0;
        const expectedSetMatchesObserved = isCorpusWide &&
          unmappedMatchCount === 0 &&
          expectedFixtureKeys.length === observedFixtureKeys.length &&
          expectedFixtureKeys.every((key: string, index: number) => key === observedFixtureKeys[index]);
        const passed = isCorpusWide
          ? expectedSetMatchesObserved
          : observedMatch === test.expected_match &&
            (!test.expected_match || (Number.isFinite(similarity) && Number(similarity) >= baseline.retrieval_similarity_threshold));
        const falsePositiveFixtureKeys = isCorpusWide
          ? observedFixtureKeys.filter((key: string) => !expectedFixtureKeys.includes(key))
          : [];
        const falseNegativeFixtureKeys = isCorpusWide
          ? expectedFixtureKeys.filter((key: string) => !observedFixtureKeys.includes(key))
          : [];
        caseResults.push({
          id: test.id,
          type: test.type,
          status: passed ? "passed" : "failed",
          fixture_key: test.fixture_key,
          expected_match: test.expected_match,
          observed_match: observedMatch,
          similarity: Number.isFinite(similarity) ? similarity : null,
          ...(isCorpusWide ? {
            expected_fixture_keys: expectedFixtureKeys,
            observed_fixture_keys: observedFixtureKeys,
            false_positive_fixture_keys: falsePositiveFixtureKeys,
            false_negative_fixture_keys: falseNegativeFixtureKeys,
            unmapped_match_count: unmappedMatchCount,
            retrieved_matches: retrievedMatches,
            ...(rankingDiagnostics ? { ranking_diagnostics: rankingDiagnostics } : {}),
          } : {}),
          ...(passed ? {} : {
            error: isCorpusWide
              ? (unmappedMatchCount > 0
                ? "Retrieved " + unmappedMatchCount + " result(s) outside the six run-specific fixtures."
                : "Expected corpus fixture set [" + expectedFixtureKeys.join(", ") + "] but observed [" + observedFixtureKeys.join(", ") + "].")
              : "Expected target match=" + test.expected_match + " but observed match=" + observedMatch + ".",
          }),
        });
      } catch (error) {
        const message = "Retrieval execution failed: " + safeError(error);
        executionFailure = { stage: test.id, kind: "execution", message };
        caseResults.push({
          id: test.id,
          type: test.type,
          status: "inconclusive",
          fixture_key: test.fixture_key,
          expected_match: test.expected_match,
          error: message,
        });
      }
    }

    // Each selected chat case must report the target knowledge evidence and reproduce its exact canary.
    for (const test of baseline.tests.filter((item: any) => item.type === "chat_grounding" || item.type === "chat_exclusion")) {
      if (!runChatChecks) {
        caseResults.push({
          id: test.id,
          type: test.type,
          status: "skipped",
          fixture_key: test.fixture_key,
          expected_match: test.expected_match,
          skip_reason: "Normal-chat checks were intentionally disabled; no provider request was made.",
        });
        continue;
      }
      if (runChatCaseId !== "all" && test.id !== runChatCaseId) {
        caseResults.push({
          id: test.id,
          type: test.type,
          status: "skipped",
          fixture_key: test.fixture_key,
          expected_match: test.expected_match,
          skip_reason: "A single normal-chat case was selected; this case was intentionally not sent to the provider.",
        });
        continue;
      }
      if (executionFailure) {
        recordNotRun(test, "Suite execution stopped after " + executionFailure.stage + ".");
        continue;
      }
      const fixture = baseline.fixtures.find((item: any) => item.key === test.fixture_key);
      const targetId = fixtureIds.get(test.fixture_key);
      try {
        providerChatRequestsAttempted += 1;
        const chatResponse = await fetch(supabaseUrl + "/functions/v1/swayphics-ai", {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "assistant_chat", message: test.query }),
        });
        const chatPayload = await chatResponse.json().catch(() => null);
        if (!chatResponse.ok || !chatPayload || typeof chatPayload.answer !== "string") {
          const message = "Normal chat execution failed with HTTP " + chatResponse.status + ": " + String(chatPayload?.error || "invalid chat response").slice(0, 250);
          executionFailure = { stage: test.id, kind: "execution", message, http_status: chatResponse.status };
          caseResults.push({
            id: test.id,
            type: test.type,
            status: "inconclusive",
            fixture_key: test.fixture_key,
            expected_match: true,
            error: message,
          });
          continue;
        }
        if (chatPayload.read_only !== true) {
          const message = "Normal chat did not affirm its read-only contract.";
          executionFailure = { stage: test.id, kind: "execution", message };
          caseResults.push({
            id: test.id,
            type: test.type,
            status: "inconclusive",
            fixture_key: test.fixture_key,
            expected_match: true,
            error: message,
          });
          continue;
        }
        const knowledge = chatPayload.knowledge_retrieval;
        if (!knowledge || knowledge.retrieval_error) {
          const message = "Normal-chat retrieval was unhealthy: " + String(knowledge?.retrieval_error?.message || knowledge?.retrieval_error || "missing retrieval status");
          executionFailure = { stage: test.id, kind: "execution", message };
          caseResults.push({
            id: test.id,
            type: test.type,
            status: "inconclusive",
            fixture_key: test.fixture_key,
            expected_match: true,
            error: message,
          });
          continue;
        }

        const matches: Array<Record<string, unknown>> = Array.isArray(knowledge.matches)
          ? knowledge.matches as Array<Record<string, unknown>>
          : [];
        const fixtureKeyById = new Map<string, string>();
        for (const [key, id] of fixtureIds.entries()) fixtureKeyById.set(id, key);
        const retrievedMatches = matches.map((item, index) => ({
          fixture_key: fixtureKeyById.get(String(item?.id || "")) || null,
          similarity: Number.isFinite(Number(item?.similarity)) ? Number(item.similarity) : null,
          rank: index + 1,
        }));
        const observedFixtureKeys = Array.from(new Set(
          retrievedMatches.map((item) => item.fixture_key).filter((key): key is string => typeof key === "string"),
        )).sort();
        const target = matches.find((item: Record<string, unknown>) => item?.id === targetId);
        const targetRetrieved = knowledge.used === true && Boolean(target);
        const answerContainsExpectedPhrase = String(chatPayload.answer).toLowerCase().includes(String(fixture.canary_phrase).toLowerCase());
        const expectsRelevantEvidence = test.expected_match === true;
        const passed = expectsRelevantEvidence
          ? targetRetrieved && answerContainsExpectedPhrase
          : !targetRetrieved && !answerContainsExpectedPhrase;
        caseResults.push({
          id: test.id,
          type: test.type,
          status: passed ? "passed" : "failed",
          fixture_key: test.fixture_key,
          expected_match: test.expected_match,
          observed_match: targetRetrieved,
          similarity: target && Number.isFinite(Number(target.similarity)) ? Number(target.similarity) : null,
          knowledge_match: targetRetrieved,
          answer_contains_expected_phrase: answerContainsExpectedPhrase,
          observed_fixture_keys: observedFixtureKeys,
          retrieved_matches: retrievedMatches,
          ...(passed ? {} : {
            error: expectsRelevantEvidence
              ? (!targetRetrieved
                ? "Normal chat did not include the expected fixture among retrieved knowledge evidence."
                : "Normal chat did not reproduce the fixture's exact canary phrase.")
              : (targetRetrieved
                ? "Normal chat leaked an unrelated fixture into retrieved knowledge evidence."
                : "Normal chat reproduced the canary phrase for an unrelated query."),
          }),
        });
      } catch (error) {
        const message = "Normal-chat execution failed: " + safeError(error);
        executionFailure = { stage: test.id, kind: "execution", message };
        caseResults.push({
          id: test.id,
          type: test.type,
          status: "inconclusive",
          fixture_key: test.fixture_key,
          expected_match: true,
          error: message,
        });
      }
    }
  } catch (error) {
    executionFailure = {
      stage: error instanceof ExecutionFailure ? error.stage : "fixture_setup",
      kind: "execution",
      message: safeError(error),
      ...(error instanceof ExecutionFailure && error.httpStatus ? { http_status: error.httpStatus } : {}),
    };
  } finally {
    // Attempt cleanup for every run-specific slug, including partially created fixtures.
    const slugs = Array.from(fixtureSlugs.values());
    const { error: deleteError } = await authenticatedDb
      .from("innerme_knowledge")
      .delete()
      .in("slug", slugs);

    if (deleteError) {
      cleanupError = deleteError.message.slice(0, 400);
    } else {
      const { data: residue, error: residueError } = await authenticatedDb
        .from("innerme_knowledge")
        .select("slug")
        .in("slug", slugs);
      if (residueError) {
        cleanupError = residueError.message.slice(0, 400);
      } else if (Array.isArray(residue) && residue.length > 0) {
        cleanupError = "One or more synthetic regression fixtures remain after cleanup.";
      }
    }
  }

  // If setup failed before a test loop began, persist explicit not_run entries
  // for every case so the report never silently undercounts the fixed suite.
  const recordedIds = new Set(caseResults.map((item) => item.id));
  for (const test of baseline.tests) {
    if (!recordedIds.has(test.id)) {
      recordNotRun(test, executionFailure
        ? "Test was not executed because suite setup/execution stopped at " + executionFailure.stage + "."
        : "Test was not executed.");
    }
  }

  const corpusCaseIds = new Set(
    baseline.tests
      .filter((item: any) => item.retrieval_scope === "corpus")
      .map((item: any) => item.id),
  );
  const evaluatedCorpusCases = caseResults.filter((item) =>
    corpusCaseIds.has(item.id) &&
    Array.isArray(item.expected_fixture_keys) &&
    Array.isArray(item.observed_fixture_keys)
  );
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const item of evaluatedCorpusCases) {
    const expected = item.expected_fixture_keys || [];
    const observed = item.observed_fixture_keys || [];
    truePositives += expected.filter((key: string) => observed.includes(key)).length;
    falsePositives += observed.filter((key: string) => !expected.includes(key)).length;
    falseNegatives += expected.filter((key: string) => !observed.includes(key)).length;
  }
  const evaluatedNegativeCases = evaluatedCorpusCases.filter((item) => (item.expected_fixture_keys || []).length === 0);
  const rejectedNegativeCases = evaluatedNegativeCases.filter((item) => (item.observed_fixture_keys || []).length === 0);
  const totalCorpusCases = corpusCaseIds.size;
  const unmappedResultCount = evaluatedCorpusCases.reduce(
    (sum, item) => sum + (item.unmapped_match_count || 0),
    0,
  );
  const totalFalsePositives = falsePositives + unmappedResultCount;
  const retrievalMetrics = {
    total_cases: totalCorpusCases,
    evaluated_cases: evaluatedCorpusCases.length,
    complete: evaluatedCorpusCases.length === totalCorpusCases,
    true_positives: truePositives,
    false_positives: totalFalsePositives,
    unmapped_result_count: unmappedResultCount,
    false_negatives: falseNegatives,
    precision: truePositives + totalFalsePositives > 0
      ? truePositives / (truePositives + totalFalsePositives)
      : null,
    recall: truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null,
    unrelated_query_count: evaluatedNegativeCases.length,
    unrelated_queries_rejected: rejectedNegativeCases.length,
    unrelated_query_rejection_rate: evaluatedNegativeCases.length > 0
      ? rejectedNegativeCases.length / evaluatedNegativeCases.length
      : null,
  };

  const failedCases = caseResults.filter((item) => item.status === "failed");
  const inconclusiveCases = caseResults.filter((item) => item.status === "inconclusive" || item.status === "not_run");
  let overallStatus: "passed" | "failed" | "inconclusive" = "passed";
  if (failedCases.length > 0 || cleanupError) {
    overallStatus = "failed";
  } else if (executionFailure || inconclusiveCases.length > 0) {
    overallStatus = "inconclusive";
  }

  const counts = {
    total: baseline.tests.length,
    passed: caseResults.filter((item) => item.status === "passed").length,
    failed: failedCases.length,
    inconclusive: caseResults.filter((item) => item.status === "inconclusive").length,
    not_run: caseResults.filter((item) => item.status === "not_run").length,
    skipped: caseResults.filter((item) => item.status === "skipped").length,
  };
  const payload = {
    ok: overallStatus === "passed",
    status: overallStatus,
    run_mode: !runChatChecks ? "retrieval_only" : (runChatCaseId === "all" ? "full" : "targeted_grounding"),
    run_chat_case_id: runChatChecks ? runChatCaseId : null,
    suite_id: SUITE_ID,
    baseline_version: BASELINE_VERSION,
    run_id: runId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    project: "isolated_test_only",
    model: EMBEDDING_MODEL,
    embedding_dimensions: embeddingDimensions,
    retrieval_similarity_threshold: baseline.retrieval_similarity_threshold,
    retrieval_metrics: retrievalMetrics,
    counts,
    case_results: caseResults,
    cleanup: {
      passed: !cleanupError,
      fixture_removed: !cleanupError,
      fixtures_attempted: fixtureSlugs.size,
      error: cleanupError,
    },
    provider_chat_requests_attempted: providerChatRequestsAttempted,
    failure: executionFailure,
    failed_case_ids: failedCases.map((item) => item.id),
  };

  return jsonResponse(payload, overallStatus === "passed" ? 200 : overallStatus === "inconclusive" ? 503 : 500);
});
