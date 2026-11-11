const SIGNATURE_TOLERANCE_SECONDS = 180;

function decodeYocoBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyYocoWebhookSignature(
  req: Request,
  rawBody: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const webhookId = req.headers.get("webhook-id") || "";
  const timestamp = req.headers.get("webhook-timestamp") || "";
  const signatureHeader = req.headers.get("webhook-signature") || "";
  const secret = Deno.env.get("YOCO_WEBHOOK_SECRET") || "";

  if (!webhookId || !/^\d+$/.test(timestamp) || !signatureHeader ||
      !secret.startsWith("whsec_")) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowMs / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const keyBytes = decodeYocoBase64(secret.slice("whsec_".length));
  if (!keyBytes) return false;

  const signedContent = webhookId + "." + timestamp + "." + rawBody;
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent),
  ));

  const candidates = Array.from(
    signatureHeader.matchAll(/(?:^|\s)v1,([A-Za-z0-9+/=]+)/g),
    (match) => match[1],
  );
  return candidates.some((candidate) => {
    const decoded = decodeYocoBase64(candidate);
    return !!decoded && constantTimeBytesEqual(expected, decoded);
  });
}
