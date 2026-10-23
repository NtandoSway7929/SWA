import {
  consumeInnerMeSseStream,
  extractInnerMeGeminiDelta,
  formatInnerMeSseEvent,
  parseInnerMeSseFrame,
} from "./innerme-sse-streaming.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(message + ": expected " + JSON.stringify(expected) +
      ", got " + JSON.stringify(actual));
  }
}

Deno.test("InnerMe SSE helpers parse provider text and terminal usage payloads", () => {
  const payload = {
    candidates: [{ content: { parts: [{ text: "Hello " }, { text: "world" }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  };
  const parsed = parseInnerMeSseFrame("event: message\ndata: " + JSON.stringify(payload));
  assertEqual(extractInnerMeGeminiDelta(parsed), "Hello \nworld", "Text delta extraction");
  assertEqual(parsed.usageMetadata.totalTokenCount, 5, "Terminal token usage preservation");
  assertEqual(parseInnerMeSseFrame("data: [DONE]"), null, "Optional DONE sentinel");
});

Deno.test("InnerMe SSE writer emits named, JSON-safe client events", () => {
  const event = formatInnerMeSseEvent("delta", { text: "hello\nworld", quote: '"' });
  assert(event.startsWith("event: delta\ndata: "), "SSE event name should be present");
  assert(event.endsWith("\n\n"), "SSE frame should end with a blank line");
  const data = event.split("\n").find((line) => line.startsWith("data:"));
  assert(data, "SSE JSON data line should be present");
  const payload = JSON.parse(data.slice(5).trim());
  assertEqual(payload.text, "hello\nworld", "Newlines should stay inside JSON data");
  assertEqual(payload.quote, '"', "Quoted text should round-trip");
});

Deno.test("InnerMe SSE consumer handles CRLF, split frames and split UTF-8 bytes", async () => {
  const frames = [
    "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello " }] } }] }) + "\r\n\r\n",
    ": keepalive\r\n\r\n",
    "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: "Swayphics 🌱" }] } }] }) + "\r\n\r\n",
    "data: " + JSON.stringify({ usageMetadata: { totalTokenCount: 11 }, candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }) + "\r\n\r\n",
  ].join("");

  const bytes = new TextEncoder().encode(frames);
  const chunks: Uint8Array[] = [];
  // Deliberately split at small byte offsets, including inside UTF-8 characters
  // and SSE framing delimiters, to mimic arbitrary network reads.
  for (let i = 0; i < bytes.length; i += 7) {
    chunks.push(bytes.slice(i, Math.min(bytes.length, i + 7)));
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });

  const payloads: any[] = [];
  const result = await consumeInnerMeSseStream(stream, (payload: unknown) => {
    payloads.push(payload);
  });

  assertEqual(result.eventCount, 3, "Comment frames should be ignored");
  assertEqual(extractInnerMeGeminiDelta(payloads[0]), "Hello ", "First incremental chunk");
  assertEqual(extractInnerMeGeminiDelta(payloads[1]), "Swayphics 🌱", "UTF-8 split chunk");
  assertEqual(payloads[2].usageMetadata.totalTokenCount, 11, "Final usage event");
});

Deno.test("InnerMe SSE consumer rejects malformed JSON rather than silently losing text", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: {broken json}\n\n"));
      controller.close();
    },
  });

  let failed = false;
  try {
    await consumeInnerMeSseStream(stream, () => {});
  } catch (error) {
    failed = error instanceof SyntaxError;
  }
  assert(failed, "Malformed SSE JSON should fail explicitly");
});


Deno.test("InnerMe SSE consumer cancels a pending read when its signal aborts", async () => {
  const abortController = new AbortController();
  let underlyingCancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      underlyingCancelled = true;
    },
  });

  const consuming = consumeInnerMeSseStream(
    stream,
    () => {},
    { signal: abortController.signal },
  );
  abortController.abort();

  let abortCaught = false;
  try {
    await consuming;
  } catch (error) {
    abortCaught = error instanceof DOMException && error.name === "AbortError";
  }

  assert(abortCaught, "Aborted stream consumption should reject with AbortError");
  assert(underlyingCancelled, "Abort should cancel the pending underlying stream read");
});
