/**
 * Minimal, dependency-free Server-Sent Events helpers for InnerMe.
 * Keep provider framing separate from UI message formatting.
 */

export function parseInnerMeSseFrame(frame) {
  const dataLines = String(frame || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));

  if (!dataLines.length) return null;

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return null;

  return JSON.parse(data);
}

export function extractInnerMeGeminiDelta(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

export function formatInnerMeSseEvent(eventName, payload) {
  const safeName = /^[a-z][a-z0-9_-]{0,30}$/i.test(String(eventName || ""))
    ? String(eventName)
    : "message";

  return "event: " + safeName + "\ndata: " + JSON.stringify(payload ?? null) + "\n\n";
}

/**
 * Consume a browser/Deno ReadableStream that uses SSE framing.
 * Handles CRLF, frames split across arbitrary network chunks, UTF-8 boundaries,
 * comments, and multiple data lines without buffering the full model answer.
 */
export async function consumeInnerMeSseStream(body, onPayload, options = {}) {
  if (!body || typeof body.getReader !== "function") {
    throw new Error("The InnerMe stream response has no readable body.");
  }
  if (typeof onPayload !== "function") {
    throw new TypeError("An InnerMe SSE payload handler is required.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;

  async function dispatch(frame) {
    if (!String(frame || "").trim()) return;
    const payload = parseInnerMeSseFrame(frame);
    if (payload === null) return;
    eventCount += 1;
    await onPayload(payload);
  }

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("The InnerMe stream was cancelled.", "AbortError");
      }

      const item = await reader.read();
      buffer += decoder.decode(item.value || new Uint8Array(), { stream: !item.done });
      // Normalise CRLF after append so a CR/LF pair split between network
      // chunks is still recognised when the next chunk arrives.
      buffer = buffer.replace(/\r\n/g, "\n");

      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        await dispatch(frame);
        separator = buffer.indexOf("\n\n");
      }

      if (item.done) break;
    }

    if (buffer.trim()) await dispatch(buffer);
    return { eventCount };
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The upstream may already have closed or been cancelled.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A failed/cancelled stream can already have released its reader.
    }
  }
}
