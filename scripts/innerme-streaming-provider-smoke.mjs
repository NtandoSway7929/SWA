import assert from "node:assert/strict";

const SUPABASE_URL = "https://ofqofhnlzbouclvvrmzd.supabase.co";
const SUPABASE_PROJECT_REF = "ofqofhnlzbouclvvrmzd";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p4UqpaLvEx_93XJSWvzo6Q_loju0xzW";
const STREAM_MESSAGE = "For this isolated streaming check, reply with exactly INNERME_STREAMING_TEST_OK and nothing else.";

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("Missing required isolated-test credential/configuration: " + name);
  return value;
}

function parseSseFrame(frame, stats) {
  const lines = frame.split(/\r?\n/);
  let eventName = "";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!eventName || !dataLines.length) return;
  const payload = JSON.parse(dataLines.join("\n"));
  stats.events.push(eventName);

  if (eventName === "delta") {
    const delta = typeof payload?.text === "string" ? payload.text : "";
    if (delta) {
      stats.deltaCount += 1;
      stats.streamedCharacters += delta.length;
      if (stats.firstDeltaMs === null) stats.firstDeltaMs = Math.round(performance.now() - stats.startedAt);
    }
  } else if (eventName === "done") {
    stats.done = payload;
    stats.doneAtMs = Math.round(performance.now() - stats.startedAt);
  } else if (eventName === "error") {
    stats.streamError = {
      retryable: payload?.retryable === true,
      messagePresent: typeof payload?.error === "string" && Boolean(payload.error.trim()),
    };
  }
}

async function main() {
  // The isolated project is hard-coded: no environment override can redirect this to production.
  assert.equal(new URL(SUPABASE_URL).hostname, SUPABASE_PROJECT_REF + ".supabase.co");
  if (String(process.env.CONFIRM_NO_BILLING || "").toLowerCase() !== "true") {
    throw new Error("Stopped before sign-in: CONFIRM_NO_BILLING must be true for the isolated Gemini test project.");
  }
  const email = requiredEnvironment("INNERME_TEST_ADMIN_EMAIL");
  const password = requiredEnvironment("INNERME_TEST_ADMIN_PASSWORD");

  const signInResponse = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!signInResponse.ok) {
    throw new Error("Isolated test-admin sign-in failed (HTTP " + signInResponse.status + "); no streaming request was sent.");
  }
  const signInPayload = await signInResponse.json();
  const accessToken = typeof signInPayload?.access_token === "string" ? signInPayload.access_token : "";
  if (!accessToken) throw new Error("Isolated sign-in returned no access token; no streaming request was sent.");

  // Exactly one assistant_chat POST; intentionally no automatic retry in this script.
  const startedAt = performance.now();
  const response = await fetch(SUPABASE_URL + "/functions/v1/swayphics-ai", {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      action: "assistant_chat",
      message: STREAM_MESSAGE,
      stream_response: true,
    }),
    signal: AbortSignal.timeout(45000),
  });

  const requestId = response.headers.get("x-innerme-request-id") || null;
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !/text\/event-stream/i.test(contentType)) {
    try { await response.body?.cancel(); } catch { /* no retry: the one request has already been sent */ }
    throw new Error("Isolated streaming request did not return HTTP 200 SSE (HTTP " +
      response.status + ", content-type " + (contentType || "missing") +
      ", request-id " + (requestId || "missing") + "). No retry was attempted.");
  }

  const stats = {
    startedAt,
    events: [],
    deltaCount: 0,
    streamedCharacters: 0,
    firstDeltaMs: null,
    doneAtMs: null,
    done: null,
    streamError: null,
  };
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response had no readable body. No retry was attempted.");

  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    buffered += decoder.decode(item.value, { stream: true });
    const frames = buffered.split(/\r?\n\r?\n/);
    buffered = frames.pop() || "";
    for (const frame of frames) parseSseFrame(frame, stats);
  }
  buffered += decoder.decode();
  if (buffered.trim()) parseSseFrame(buffered, stats);

  assert.equal(stats.streamError, null, "The provider stream returned an error event.");
  assert.ok(stats.deltaCount > 0, "The SSE response contained no incremental delta events.");
  assert.ok(stats.done && typeof stats.done.answer === "string" && stats.done.answer.trim(),
    "The SSE response did not finish with a non-empty done.answer.");
  assert.equal(stats.done.read_only, true, "Normal chat must affirm its read-only contract.");
  assert.ok(stats.events.indexOf("delta") >= 0 && stats.events.lastIndexOf("done") > stats.events.indexOf("delta"),
    "The terminal done event must follow at least one delta.");
  assert.ok(stats.done.knowledge_retrieval && typeof stats.done.knowledge_retrieval === "object",
    "Terminal event must include knowledge_retrieval metadata.");

  // Report timing and counts only; never print the answer, access token, or credential material.
  process.stdout.write(JSON.stringify({
    status: "passed",
    project: "isolated_test_only",
    project_ref: SUPABASE_PROJECT_REF,
    provider_backed: true,
    assistant_chat_requests_sent: 1,
    http_status: response.status,
    content_type: contentType,
    request_id: requestId,
    model: typeof stats.done.model === "string" ? stats.done.model : "unreported",
    event_sequence: stats.events,
    delta_count: stats.deltaCount,
    streamed_characters: stats.streamedCharacters,
    first_delta_ms: stats.firstDeltaMs,
    stream_finished_ms: stats.doneAtMs,
    total_elapsed_ms: Math.round(performance.now() - startedAt),
    read_only: stats.done.read_only,
    retrieval_error: Boolean(stats.done.knowledge_retrieval?.retrieval_error),
    retrieval_match_count: Array.isArray(stats.done.knowledge_retrieval?.matches)
      ? stats.done.knowledge_retrieval.matches.length : 0,
    retry_attempts: 0,
  }, null, 2) + "\n");
}

main().catch((error) => {
  // Keep the failure report free of request content and all secrets.
  process.stderr.write("ISOLATED_INNERME_STREAM_SMOKE=FAIL " +
    (error instanceof Error ? error.message : "Unexpected test failure") + "\n");
  process.exitCode = 1;
});
