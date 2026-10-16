import { createClient } from "npm:@supabase/supabase-js@2";

// This is a test-only endpoint. It deliberately refuses to run anywhere except
// the isolated Swayphics InnerMe Test project. Do not deploy it to production.
const ISOLATED_PROJECT_REF = "ofqofhnlzbouclvvrmzd";
const FIXTURE_DOMAIN_PREFIX = "innerme-semantic-retrieval-smoke-test";

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(
        input: string,
        options?: { mean_pool?: boolean; normalize?: boolean },
      ): Promise<Iterable<number>>;
    };
  };
};

function jsonResponse(
  payload: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
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
      error: "Safety stop: this test endpoint only runs in the isolated InnerMe test project.",
    }, 403);
  }

  if (!serviceKey || !anonKey) {
    return jsonResponse({ ok: false, error: "Required server-side Supabase keys are unavailable." }, 500);
  }

  const authorization = req.headers.get("authorization") || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!accessToken) {
    return jsonResponse({ ok: false, error: "A signed-in isolated test-admin token is required." }, 401);
  }

  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data: authData, error: authError } =
    await adminDb.auth.getUser(accessToken);
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

  const runId = crypto.randomUUID().replaceAll("-", "");
  const fixtureSlug = "__innerme_semantic_retrieval_smoke_test_" + runId + "__";
  const fixtureDomain = FIXTURE_DOMAIN_PREFIX + "-" + runId;
  const canaryPhrase = "Cobalt Compass 417";
  const fixtureStatement =
    "For this isolated verification test, the exact marker phrase is " +
    canaryPhrase +
    ". When asked for the isolated semantic retrieval canary's marker phrase, return " +
    canaryPhrase +
    " exactly. This is synthetic test-only content, not a real business fact.";
  const testQuery =
    "What exact marker phrase should be returned for the isolated semantic retrieval canary test?";

  let stage = "fixture_insert";
  let fixtureId = "";
  let failure: string | null = null;
  let cleanupError: string | null = null;
  let retrievalFound = false;
  let retrievalSimilarity: number | null = null;
  let chatFoundKnowledge = false;
  let chatAnswerContainsCanary = false;
  let chatMatchSimilarity: number | null = null;
  let queryEmbeddingDimensions = 0;
  let answer = "";

  try {
    // The run-specific slug/domain prevent parallel tests from matching each
    // other's fixture. The workflow also uses a non-cancelling concurrency group.
    const { data: inserted, error: insertError } = await adminDb
      .from("innerme_knowledge")
      .insert({
        slug: fixtureSlug,
        title: "Isolated semantic retrieval canary marker phrase",
        domain: fixtureDomain,
        knowledge_type: "definition",
        statement: fixtureStatement,
        application: "Use only to verify the isolated semantic retrieval path.",
        constraints: "Synthetic test-only data; not applicable to real business decisions.",
        do_not_use_when: "Never treat this isolated canary as real business or client knowledge.",
        evidence_level: "internal",
        confidence: "high",
        jurisdiction: "Global",
        tags: ["synthetic", "semantic-retrieval-test", "canary"],
        priority: 100,
        status: "active",
        last_verified_at: new Date().toISOString(),
        review_after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: user.id,
        verification_status: "verified",
        verification_method: "isolated_semantic_retrieval_e2e_smoke",
        verification_notes: "Synthetic canary record, automatically removed after this test.",
        embedding_status: "pending",
      })
      .select("id, embedding_text")
      .single();

    if (insertError || !inserted) {
      throw new Error("Fixture insert failed: " + (insertError?.message || "no row returned"));
    }
    fixtureId = inserted.id;

    const embeddingText = String(inserted.embedding_text || "").trim();
    if (!embeddingText.includes(canaryPhrase)) {
      throw new Error("Embedding-text trigger did not include the canary phrase.");
    }

    stage = "document_embedding";
    const model = new Supabase.ai.Session("gte-small");
    const rawEmbedding = await model.run(embeddingText, {
      mean_pool: true,
      normalize: true,
    });
    const documentEmbedding = Array.from(rawEmbedding as Iterable<number>);
    queryEmbeddingDimensions = documentEmbedding.length;

    if (documentEmbedding.length !== 384) {
      throw new Error("Expected 384 document-embedding dimensions; received " + documentEmbedding.length + ".");
    }

    const { error: embeddingUpdateError } = await adminDb
      .from("innerme_knowledge")
      .update({
        embedding: JSON.stringify(documentEmbedding),
        embedding_model: "gte-small",
        embedding_version: 1,
        embedding_status: "ready",
        embedding_error: null,
        embedded_at: new Date().toISOString(),
      })
      .eq("id", fixtureId);

    if (embeddingUpdateError) {
      throw new Error("Could not save the synthetic gte-small embedding: " + embeddingUpdateError.message);
    }

    stage = "natural_language_search";
    const searchResponse = await fetch(supabaseUrl + "/functions/v1/swayphics-ai", {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "search_knowledge",
        query: testQuery,
        match_threshold: 0.45,
        match_count: 6,
        filter_domain: fixtureDomain,
        filter_jurisdiction: "Global",
        filter_knowledge_type: "definition",
      }),
    });

    const searchPayload = await searchResponse.json().catch(() => null);
    if (!searchResponse.ok || !searchPayload || searchPayload.ok !== true) {
      throw new Error(
        "Deployed search_knowledge action failed with HTTP " +
          searchResponse.status +
          ": " +
          String(searchPayload?.error || "invalid response").slice(0, 250),
      );
    }
    if (searchPayload.read_only !== true || searchPayload.embedding_dimensions !== 384) {
      throw new Error("The deployed semantic search did not affirm its read-only 384-dimensional retrieval contract.");
    }

    const searchMatches = Array.isArray(searchPayload.matches) ? searchPayload.matches : [];
    const retrieved = searchMatches.find((match: Record<string, unknown>) => match?.slug === fixtureSlug);
    if (!retrieved) {
      throw new Error("Natural-language search did not retrieve the synthetic record.");
    }
    retrievalSimilarity = Number(retrieved.similarity);
    if (!Number.isFinite(retrievalSimilarity) || retrievalSimilarity < 0.45) {
      throw new Error("Retrieved synthetic record was below the 0.45 semantic similarity threshold.");
    }
    retrievalFound = true;

    stage = "normal_chat_grounding";
    const chatResponse = await fetch(supabaseUrl + "/functions/v1/swayphics-ai", {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "assistant_chat",
        message:
          "What exact marker phrase does the isolated semantic retrieval canary test specify? " +
          "Answer using verified knowledge rather than guessing, and return the phrase exactly.",
      }),
    });

    const chatPayload = await chatResponse.json().catch(() => null);
    if (!chatResponse.ok || !chatPayload || typeof chatPayload.answer !== "string") {
      throw new Error(
        "Normal chat could not return an answer (HTTP " +
          chatResponse.status +
          "): " +
          String(chatPayload?.error || "invalid response").slice(0, 250),
      );
    }
    if (chatPayload.read_only !== true) {
      throw new Error("The normal-chat request did not affirm its read-only contract.");
    }

    const knowledge = chatPayload.knowledge_retrieval;
    if (!knowledge || knowledge.retrieval_error) {
      throw new Error(
        "Normal chat knowledge retrieval was unhealthy: " +
          String(knowledge?.retrieval_error?.message || knowledge?.retrieval_error || "missing retrieval status"),
      );
    }

    const chatMatches = Array.isArray(knowledge.matches) ? knowledge.matches : [];
    const chatMatch = chatMatches.find((match: Record<string, unknown>) =>
      match?.id === fixtureId || match?.title === "Isolated semantic retrieval canary marker phrase"
    );
    if (knowledge.used !== true || !chatMatch) {
      throw new Error("Normal chat did not report the synthetic knowledge record among its retrieved evidence.");
    }

    chatFoundKnowledge = true;
    chatMatchSimilarity = Number(chatMatch.similarity);
    answer = String(chatPayload.answer).slice(0, 700);
    chatAnswerContainsCanary = answer.toLowerCase().includes(canaryPhrase.toLowerCase());

    if (!chatAnswerContainsCanary) {
      throw new Error("Normal chat retrieved the canary but did not return its exact marker phrase; grounding check failed.");
    }
  } catch (error) {
    failure = safeError(error);
  } finally {
    stage = "cleanup";
    // Delete by this invocation's unique slug, even if insert/update/search/chat
    // failed after a row was created. No production URL passes the guard above.
    const { error: deleteError } = await adminDb
      .from("innerme_knowledge")
      .delete()
      .eq("slug", fixtureSlug);

    if (deleteError) {
      cleanupError = deleteError.message.slice(0, 400);
    } else {
      const { data: residue, error: residueError } = await adminDb
        .from("innerme_knowledge")
        .select("id")
        .eq("slug", fixtureSlug)
        .limit(1);

      if (residueError) {
        cleanupError = residueError.message.slice(0, 400);
      } else if (Array.isArray(residue) && residue.length) {
        cleanupError = "Synthetic retrieval fixture remained after cleanup.";
      }
    }
  }

  const ok = !failure && !cleanupError && retrievalFound && chatFoundKnowledge && chatAnswerContainsCanary;
  return jsonResponse({
    ok,
    test: "innerme_semantic_retrieval_e2e",
    stage,
    project: "isolated_test_only",
    model: "gte-small",
    embedding_dimensions: queryEmbeddingDimensions,
    natural_language_retrieval: {
      passed: retrievalFound,
      similarity: retrievalSimilarity,
    },
    normal_chat_grounding: {
      passed: chatFoundKnowledge && chatAnswerContainsCanary,
      knowledge_match: chatFoundKnowledge,
      answer_contains_canary: chatAnswerContainsCanary,
      matched_similarity: chatMatchSimilarity,
      answer_excerpt: answer,
    },
    cleanup: {
      passed: !cleanupError,
      fixture_removed: !cleanupError,
      error: cleanupError,
    },
    provider_chat_request_made: true,
    failure,
  }, ok ? 200 : 500);
});
