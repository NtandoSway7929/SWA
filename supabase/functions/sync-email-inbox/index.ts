import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@2.0.5";
import PostalMime from "npm:postal-mime@4.2.0";
import {
  getSyncStartUid,
  resolveMatchingThreadMessage,
  selectUidBatch,
} from "./inbox-helpers.mjs";
import { sanitizeEmailFilename } from "./email-mime-helpers.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://swayphics.co.za",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

const MAILBOX = "info@swayphics.co.za";

const INITIAL_SYNC_LIMIT = 25;
const MAX_MESSAGES_PER_SYNC = 10;
// Bound raw RFC822 retrieval and MIME parsing to protect Edge Function memory.
const MAX_SOURCE_LENGTH = 32 * 1024 * 1024;
const EMAIL_ATTACHMENT_BUCKET = "swayphics-email-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_STORED_ATTACHMENTS = 12;
// Backfill one pending email per authenticated sync to keep each retry bounded.
const EXISTING_MEDIA_BACKFILL_BATCH = 1;
const IMAP_CONNECTION_TIMEOUT_MS = 8000;
const IMAP_GREETING_TIMEOUT_MS = 8000;
// Scheduled header ingestion has a 30-second HTTP deadline; MIME hydration
// runs only on authenticated dashboard requests and needs a longer idle window.
const IMAP_SCHEDULED_SOCKET_TIMEOUT_MS = 12000;
const IMAP_MEDIA_SOCKET_TIMEOUT_MS = 30000;

function firstAddress(value: any) {
  let address = value;

  if (Array.isArray(address)) {
    address = address[0] || null;
  }

  if (
    address &&
    "group" in address &&
    Array.isArray(address.group)
  ) {
    address = address.group[0] || null;
  }

  return {
    name: String(address?.name || "").trim(),
    email: String(
      address?.address ||
      address?.email ||
      ""
    ).trim().toLowerCase()
  };
}

function cleanHeaderValue(value: unknown) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function messageIds(value: unknown) {
  return String(value || "").match(/<[^>]+>/g) || [];
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function attachmentContentBytes(value: any): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("The MIME parser returned attachment content in an unsupported format.");
}

async function fetchMessageBody(source: any, reportedSize: number | null | undefined) {
  if (!source) throw new Error("The IMAP server did not return the full message source.");

  const sourceBytes = source instanceof Uint8Array
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : null;

  if (!sourceBytes || !sourceBytes.byteLength) {
    throw new Error("The IMAP server returned an empty or unsupported message source.");
  }

  if (
    Number(reportedSize || 0) > MAX_SOURCE_LENGTH ||
    sourceBytes.byteLength > MAX_SOURCE_LENGTH ||
    (Number(reportedSize || 0) > 0 && Number(reportedSize) !== sourceBytes.byteLength)
  ) {
    throw new Error("The full email source exceeds the permitted download size or was truncated.");
  }

  const parsed = await PostalMime.parse(sourceBytes, {
    attachmentEncoding: "arraybuffer",
    maxNestingDepth: 64,
    maxHeadersSize: 1024 * 1024,
    maxPartCount: 256,
    maxRfc822NestingDepth: 5,
    maxForwardedAddresses: 1000
  });

  const attachments = (Array.isArray(parsed.attachments) ? parsed.attachments : [])
    .map((attachment: any, index: number) => {
      const contentBytes = attachmentContentBytes(attachment.content);
      return {
        part: String(index + 1),
        filename: sanitizeEmailFilename(attachment.filename, "attachment-" + String(index + 1)),
        contentType: String(attachment.mimeType || "application/octet-stream"),
        sizeBytes: contentBytes.byteLength,
        contentId: String(attachment.contentId || "").trim().replace(/^<|>$/g, ""),
        disposition: String(attachment.disposition || (attachment.related ? "inline" : "attachment")),
        contentBytes
      };
    });

  const html = typeof parsed.html === "string" && parsed.html.trim() ? parsed.html : null;
  const plainText = typeof parsed.text === "string" ? parsed.text.trim() : "";

  return {
    text: plainText || (html ? stripHtml(html) : ""),
    html,
    bodyDownloadSucceeded: true,
    mimeParts: { attachments }
  };
}

async function fetchMessageBodyFromMailbox(
  imapClient: any,
  uid: number,
  reportedSize: number | null | undefined
) {
  if (Number(reportedSize || 0) > MAX_SOURCE_LENGTH) {
    throw new Error("The full email source exceeds the permitted download size.");
  }

  const message = await imapClient.fetchOne(
    uid,
    { source: { start: 0, maxLength: MAX_SOURCE_LENGTH } },
    { uid: true }
  );

  if (!message?.source) {
    throw new Error("The IMAP server did not return the full message source.");
  }

  return fetchMessageBody(message.source, reportedSize ?? message.size);
}


function attachmentStoragePath(messageRecordId: string, part: any) {
  const partKey = String(part.part || "part").replace(/[^0-9.]/g, "_").replace(/\.+/g, "-");
  return messageRecordId + "/" + partKey + "-" + sanitizeEmailFilename(part.filename);
}

async function storeEmailAttachments(mimeAttachments: any[], supabase: any, messageRecordId: string) {
  const stored: any[] = [];
  const uploadedPaths: string[] = [];
  let totalStoredBytes = 0;
  const descriptors = Array.isArray(mimeAttachments) ? mimeAttachments : [];

  for (const descriptor of descriptors.slice(0, MAX_STORED_ATTACHMENTS)) {
    const entry: Record<string, unknown> = {
      filename: sanitizeEmailFilename(descriptor.filename),
      content_type: String(descriptor.contentType || "application/octet-stream"),
      size_bytes: descriptor.sizeBytes ?? null,
      content_id: String(descriptor.contentId || ""),
      disposition: String(descriptor.disposition || "attachment"),
      is_inline: String(descriptor.disposition || "") === "inline" || Boolean(descriptor.contentId),
      is_previewable_image: /^image\/(?:jpeg|png|gif|webp|avif)$/i.test(String(descriptor.contentType || "")),
      status: "pending"
    };

    const bytes = descriptor.contentBytes instanceof Uint8Array
      ? descriptor.contentBytes
      : descriptor.contentBytes instanceof ArrayBuffer
        ? new Uint8Array(descriptor.contentBytes)
        : null;

    if (!bytes) throw new Error("The parsed MIME attachment has no downloadable content.");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      entry.status = "too_large";
      stored.push(entry);
      continue;
    }
    if (totalStoredBytes + bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
      entry.status = "storage_limit";
      stored.push(entry);
      continue;
    }

    const storagePath = attachmentStoragePath(messageRecordId, descriptor);
    const uploadResult = await supabase.storage.from(EMAIL_ATTACHMENT_BUCKET).upload(storagePath, bytes, {
      contentType: String(descriptor.contentType || "application/octet-stream"),
      cacheControl: "3600",
      upsert: true
    });
    if (uploadResult.error) {
      if (uploadedPaths.length) await supabase.storage.from(EMAIL_ATTACHMENT_BUCKET).remove(uploadedPaths);
      throw uploadResult.error;
    }

    uploadedPaths.push(storagePath);
    totalStoredBytes += bytes.byteLength;
    entry.size_bytes = bytes.byteLength;
    entry.storage_path = storagePath;
    entry.status = "stored";
    stored.push(entry);
  }

  for (const descriptor of descriptors.slice(MAX_STORED_ATTACHMENTS)) {
    stored.push({
      filename: sanitizeEmailFilename(descriptor.filename),
      content_type: String(descriptor.contentType || "application/octet-stream"),
      size_bytes: descriptor.sizeBytes ?? null,
      content_id: String(descriptor.contentId || ""),
      disposition: String(descriptor.disposition || "attachment"),
      is_inline: String(descriptor.disposition || "") === "inline" || Boolean(descriptor.contentId),
      is_previewable_image: /^image\/(?:jpeg|png|gif|webp|avif)$/i.test(String(descriptor.contentType || "")),
      status: "attachment_limit"
    });
  }
  return stored;
}

async function cleanupStoredEmailAttachments(
  supabase: any,
  attachments: any[]
) {
  const paths = (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => String(attachment?.storage_path || ""))
    .filter((path) => path.length > 0);

  if (!paths.length) return;

  const result = await supabase.storage
    .from(EMAIL_ATTACHMENT_BUCKET)
    .remove(paths);
  if (result.error) {
    console.error("Unable to clean up unlinked email attachments:", result.error);
  }
}

function describeImapError(error: unknown) {
  const value = error as any;

  if (value?.authenticationFailed) {
    return "IMAP authentication failed. Check EMAIL_IMAP_PASSWORD for info@swayphics.co.za.";
  }

  const responseText =
    value?.responseText ||
    value?.response?.responseText ||
    value?.response?.text ||
    "";

  const responseCode =
    value?.response?.code ||
    value?.serverResponseCode ||
    "";

  if (responseText || responseCode) {
    return [
      responseText || "IMAP command failed.",
      responseCode
        ? "code=" + String(responseCode)
        : ""
    ]
      .filter(Boolean)
      .join(" | ");
  }

  return (
    value?.message ||
    "Unable to synchronize the Swayphics email inbox."
  );
}

async function findExistingThread(
  supabase: any,
  candidates: string[]
) {
  if (!candidates.length) {
    return null;
  }

  const result = await supabase
    .from("email_messages")
    .select("message_id,thread_id,client_id,lead_id")
    .in("message_id", candidates)
    .limit(candidates.length);

  if (result.error) {
    throw result.error;
  }

  return resolveMatchingThreadMessage(
    candidates,
    result.data || [],
  );
}

async function findExistingInboundMessage(
  supabase: any,
  messageId: string | null
) {
  if (!messageId) {
    return null;
  }

  const result = await supabase
    .from("email_messages")
    .select("id,attachments,media_processed_at,text_body,html_body")
    .eq("mailbox", MAILBOX)
    .eq("direction", "inbound")
    .eq("message_id", messageId)
    .limit(1);

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0] || null;
}

async function findContact(
  supabase: any,
  email: string
) {
  if (!email) {
    return {
      clientId: null,
      leadId: null
    };
  }

  const normalizedEmail =
    email.toLowerCase();

  const clientResult =
    await supabase
      .from("clients")
      .select("id")
      .ilike("email", normalizedEmail)
      .limit(1);

  if (clientResult.data?.[0]?.id) {
    return {
      clientId: clientResult.data[0].id,
      leadId: null
    };
  }

  const leadResult =
    await supabase
      .from("leads")
      .select("id")
      .ilike("email", normalizedEmail)
      .limit(1);

  if (leadResult.data?.[0]?.id) {
    return {
      clientId: null,
      leadId: leadResult.data[0].id
    };
  }

  return {
    clientId: null,
    leadId: null
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return Response.json(
      {
        error: "Method not allowed."
      },
      {
        status: 405,
        headers: corsHeaders
      }
    );
  }

  let client: any = null;
  let mailboxLock: any = null;

  try {
    const authorization =
      req.headers.get("Authorization") || "";

    const accessToken =
      authorization.replace(
        /^Bearer\s+/i,
        ""
      ).trim();

    if (!accessToken) {
      return Response.json(
        {
          error:
            "Authentication required."
        },
        {
          status: 401,
          headers: corsHeaders
        }
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );

    const publicApiKey =
      req.headers.get("apikey") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    const imapPassword =
      Deno.env.get(
        "EMAIL_IMAP_PASSWORD"
      );

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase server configuration is missing."
      );
    }

    if (!publicApiKey) {
      throw new Error(
        "Supabase public API key is missing."
      );
    }

    if (!imapPassword) {
      return Response.json(
        {
          error:
            "Email inbox is not configured yet. Add EMAIL_IMAP_PASSWORD to the Supabase Edge Function secrets."
        },
        {
          status: 503,
          headers: corsHeaders
        }
      );
    }

    const authSupabase = createClient(
      supabaseUrl,
      publicApiKey
    );

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    const looksLikeJwt =
      accessToken.split(".").length === 3;

    const userResult = looksLikeJwt
      ? await authSupabase.auth.getUser(accessToken)
      : null;

    const isAuthenticatedUser =
      Boolean(
        userResult &&
        !userResult.error &&
        userResult.data?.user
      );

    if (!isAuthenticatedUser) {
      // Scheduled ingestion uses a random token held only in Supabase Vault.
      // The RPC is executable only by this function's service-role client.
      const scheduledResult = await supabase.rpc(
        "verify_swayphics_email_sync_cron_token",
        {
          p_token: accessToken
        }
      );

      if (
        scheduledResult.error ||
        scheduledResult.data !== true
      ) {
        return Response.json(
          {
            error:
              "Your admin session is invalid or expired."
          },
          {
            status: 401,
            headers: corsHeaders
          }
        );
      }
    }

    const imapHost =
      Deno.env.get(
        "EMAIL_IMAP_HOST"
      ) ||
      "imap.hmailplus.com";

    const imapPort =
      Number(
        Deno.env.get(
          "EMAIL_IMAP_PORT"
        ) ||
        "993"
      );

    const imapUser =
      Deno.env.get(
        "EMAIL_IMAP_USER"
      ) ||
      MAILBOX;

    const folder =
      Deno.env.get(
        "EMAIL_IMAP_FOLDER"
      ) ||
      "INBOX";

    client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      logger: false,
      disableCompression: true,
      disableAutoIdle: true,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: isAuthenticatedUser
        ? IMAP_MEDIA_SOCKET_TIMEOUT_MS
        : IMAP_SCHEDULED_SOCKET_TIMEOUT_MS,
      auth: {
        user: imapUser,
        pass: imapPassword
      }
    });

    client.on("error", (error: unknown) => {
      console.error("Swayphics IMAP connection error:", describeImapError(error));
    });

    await client.connect();

    mailboxLock =
      await client.getMailboxLock(
        folder,
        {
          readOnly: true,
          description:
            "Swayphics inbox sync"
        }
      );

    const uidValidity =
      Number(
        client.mailbox?.uidValidity || 0
      );

    if (
      !Number.isSafeInteger(uidValidity) ||
      uidValidity <= 0
    ) {
      throw new Error(
        "IMAP did not return a valid UIDVALIDITY for the inbox. Sync stopped without advancing the cursor."
      );
    }

    const uidNext =
      Number(
        client.mailbox?.uidNext || 0
      );

    const newestUid =
      Math.max(0, uidNext - 1);

    if (!newestUid) {
      console.info(
        "Swayphics email inbox sync completed:",
        JSON.stringify({
          uid_validity: uidValidity,
          newest_uid: 0,
          synced: 0
        })
      );

      return Response.json(
        {
          success: true,
          uid_validity: uidValidity,
          synced: 0,
          unread: 0
        },
        {
          status: 200,
          headers: corsHeaders
        }
      );
    }

    const latestStoredResult =
      await supabase
        .from("email_messages")
        .select("imap_uid")
        .eq("mailbox", MAILBOX)
        .eq("imap_uid_validity", uidValidity)
        .not("imap_uid", "is", null)
        .order("imap_uid", {
          ascending: false
        })
        .limit(1);

    if (latestStoredResult.error) {
      throw latestStoredResult.error;
    }

    const latestStoredUid =
      Number(
        latestStoredResult.data?.[0]
          ?.imap_uid || 0
      );

    const startUid = getSyncStartUid(
      latestStoredUid,
      newestUid,
      INITIAL_SYNC_LIMIT
    );

    let searchedUids =
      startUid <= newestUid
        ? await client.search(
            {
              uid:
                String(startUid) +
                ":" +
                String(newestUid)
            },
            {
              uid: true
            }
          )
        : [];

    if (!Array.isArray(searchedUids)) {
      searchedUids = [];
    }

    const allCandidateUids = selectUidBatch(
      searchedUids,
      Number.MAX_SAFE_INTEGER,
    );
    const candidateUids = selectUidBatch(
      allCandidateUids,
      MAX_MESSAGES_PER_SYNC,
    );

    let synced = 0;
    let alreadyStored = 0;
    let failedUid: number | null = null;
    const mediaAttemptedMessageIds = new Set<string>();

    for (const targetUid of candidateUids) {
      try {
        const message =
          await client.fetchOne(
            targetUid,
            {
              envelope: true,
              internalDate: true,
              flags: true,
              size: isAuthenticatedUser
            },
            {
              uid: true
            }
          );

        if (!message) {
          failedUid = targetUid;
          break;
        }

        const envelope =
          message.envelope || {};

        const from =
          firstAddress(
            envelope.from
          );

        const to =
          firstAddress(
            envelope.to
          );

        const subject =
          cleanHeaderValue(
            envelope.subject ||
            "No subject"
          );

        const messageId =
          cleanHeaderValue(
            envelope.messageId
          ) || null;

        const inReplyTo =
          cleanHeaderValue(
            envelope.inReplyTo
          ) || null;

        const existingInbound =
          await findExistingInboundMessage(
            supabase,
            messageId
          );

        if (existingInbound) {
          const existingSourceKey =
            "imap:" +
            String(uidValidity) +
            ":" +
            folder +
            ":" +
            String(targetUid);

          const mediaAlreadyProcessed = Boolean(existingInbound.media_processed_at);
          let mediaUpdate: Record<string, unknown> = {};

          // Scheduled ingestion must never block message visibility on media
          // downloads. An authenticated inbox refresh can hydrate pending media
          // after the message row already exists.
          if (!mediaAlreadyProcessed && isAuthenticatedUser) {
            mediaAttemptedMessageIds.add(String(existingInbound.id));
            const existingBody = await fetchMessageBodyFromMailbox(
              client,
              targetUid,
              message.size
            );
            const hydratedAttachments = await storeEmailAttachments(
              existingBody.mimeParts.attachments,
              supabase,
              String(existingInbound.id)
            );
            mediaUpdate = {
              text_body: existingBody.text || existingInbound.text_body || subject || "(Email received)",
              html_body: existingBody.html || existingInbound.html_body || null,
              attachments: hydratedAttachments,
              media_processed_at: existingBody.bodyDownloadSucceeded
                ? new Date().toISOString()
                : null
            };
          }

          const updatedExisting =
            await supabase
              .from("email_messages")
              .update({
                imap_uid: Number(targetUid),
                imap_uid_validity: uidValidity,
                source_key: existingSourceKey,
                ...mediaUpdate
              })
              .eq("id", existingInbound.id);

          if (updatedExisting.error) {
            throw updatedExisting.error;
          }

          alreadyStored += 1;
          continue;
        }

        const references =
          cleanHeaderValue(
            envelope.references
          ) || null;

        const candidates =
          Array.from(
            new Set([
              ...messageIds(
                inReplyTo
              ),
              ...messageIds(
                references
              ),
              ...(messageId
                ? [messageId]
                : [])
            ])
          );

        const existingThread =
          await findExistingThread(
            supabase,
            candidates
          );

        let threadId =
          existingThread?.thread_id || null;

        if (!threadId) {
          threadId =
            candidates[0] ||
            messageId ||
            "imap:" +
              folder +
              ":" +
              String(targetUid);
        }

        const fromEmail =
          from.email || "";

        let textBody =
          subject ||
          "(Email received)";

        const fallbackDate =
          message.internalDate
            instanceof Date
            ? message.internalDate
            : new Date();

        const receivedAt =
          fallbackDate.toISOString();

        const messageFlags =
          message?.flags &&
          typeof message.flags[Symbol.iterator] ===
            "function"
            ? Array.from(message.flags)
            : [];

        const isRead =
          messageFlags.some(
            (flag) =>
              String(flag).toLowerCase() ===
              "\\seen"
          );

        const emailContact =
          await findContact(
            supabase,
            fromEmail
          );

        // Replies inherit the known CRM contact from the referenced outbound
        // message when sender-address matching alone cannot identify it.
        const threadContact =
          existingThread?.client_id ||
          existingThread?.lead_id
            ? {
                clientId: existingThread.client_id || null,
                leadId: existingThread.lead_id || null,
              }
            : null;

        const contact =
          threadContact || emailContact;

        const sourceKey =
          "imap:" +
          String(uidValidity) +
          ":" +
          folder +
          ":" +
          String(targetUid);

        const emailRecordId = crypto.randomUUID();

        // Persist the email first. Media is optional enrichment and must not
        // prevent the message from appearing in the inbox.
        const inserted =
          await supabase
            .from("email_messages")
            .insert({
              id: emailRecordId,
              direction: "inbound",
              mailbox: MAILBOX,
              source_key: sourceKey,
              imap_uid:
                Number(targetUid),
              imap_uid_validity: uidValidity,
              external_id: null,
              message_id: messageId,
              in_reply_to:
                inReplyTo,
              references_header:
                references,
              thread_id: threadId,
              from_name:
                from.name || null,
              from_email:
                fromEmail || null,
              to_email:
                to.email || MAILBOX,
              subject:
                subject || null,
              text_body:
                textBody ||
                subject ||
                "(Email received)",
              html_body: null,
              attachments: [],
              media_processed_at: null,
              received_at:
                receivedAt,
              is_read: isRead,
              client_id:
                contact.clientId,
              lead_id:
                contact.leadId,
              created_by: null
            })
            .select("id")
            .single();

        if (inserted.error) {
          if (
            inserted.error.code !==
            "23505"
          ) {
            throw inserted.error;
          }
        } else {
          synced += 1;
          mediaAttemptedMessageIds.add(emailRecordId);

          if (isAuthenticatedUser) {
            try {
              const body = await fetchMessageBodyFromMailbox(
                client,
                targetUid,
                message.size
              );
              textBody = body.text || textBody;
              const attachmentMetadata = await storeEmailAttachments(
                body.mimeParts.attachments,
                supabase,
                emailRecordId
              );
              const mediaUpdate = await supabase
                .from("email_messages")
                .update({
                  text_body: textBody,
                  html_body: body.html || null,
                  attachments: attachmentMetadata,
                  media_processed_at: body.bodyDownloadSucceeded
                    ? new Date().toISOString()
                    : null
                })
                .eq("id", emailRecordId)
                .is("media_processed_at", null);

              if (mediaUpdate.error) {
                await cleanupStoredEmailAttachments(supabase, attachmentMetadata);
                throw mediaUpdate.error;
              }
            } catch (mediaError) {
              // Keep the already-inserted email visible. Pending media can be
              // retried by the next authenticated inbox sync.
              console.error("Inbound email media hydration deferred:", {
                uid: targetUid,
                error: String((mediaError as any)?.message || mediaError || "Unknown error")
              });
            }
          }

          if (
            contact.clientId ||
            contact.leadId
          ) {
            const logResult =
              await supabase
                .from(
                  "communication_logs"
                )
                .insert({
                  client_id:
                    contact.clientId,
                  lead_id:
                    contact.leadId,
                  channel: "Email",
                  direction:
                    "inbound",
                  subject:
                    subject || null,
                  message:
                    textBody ||
                    subject ||
                    "(Email received)",
                  contacted_at:
                    receivedAt,
                  created_by: null
                });

            if (logResult.error) {
              console.error(
                "Inbound communication log insert failed:",
                logResult.error
              );
            }
          }
        }
      } catch (messageError) {
        console.error(
          "Unable to synchronize IMAP message " +
            String(targetUid) +
            ":",
          messageError
        );

        // Do not store any later UID after a failure. The next sync starts
        // from the latest stored UID, so continuing here could skip this
        // failed message permanently.
        failedUid = targetUid;
        break;
      }
    }

    let existingMediaHydrated = 0;
    if (isAuthenticatedUser && failedUid === null) {
      try {
        const pendingMedia = await supabase
          .from("email_messages")
          .select("id,imap_uid,imap_uid_validity,message_id,media_processed_at,text_body,html_body")
          .eq("mailbox", MAILBOX)
          .eq("direction", "inbound")
          .eq("imap_uid_validity", uidValidity)
          .is("media_processed_at", null)
          .not("imap_uid", "is", null)
          .order("received_at", { ascending: false })
          .limit(EXISTING_MEDIA_BACKFILL_BATCH);

        if (pendingMedia.error) throw pendingMedia.error;

        for (const record of (pendingMedia.data || []).filter(
          (item: any) => !mediaAttemptedMessageIds.has(String(item.id))
        )) {
          const storedUid = Number(record.imap_uid);
          if (!Number.isSafeInteger(storedUid) || storedUid <= 0 || !record.message_id) continue;

          const storedMessage = await client.fetchOne(
            storedUid,
            {
              envelope: true,
              size: true
            },
            { uid: true }
          );

          const liveMessageId = cleanHeaderValue(storedMessage?.envelope?.messageId || "");
          if (!storedMessage || liveMessageId !== String(record.message_id).trim()) {
            continue;
          }

          const refreshedBody = await fetchMessageBodyFromMailbox(
            client,
            storedUid,
            storedMessage.size
          );

          if (!refreshedBody.bodyDownloadSucceeded) {
            console.warn("Inbound email body hydration remains pending:", {
              uid: storedUid
            });
            continue;
          }

          const refreshedAttachments = await storeEmailAttachments(
            refreshedBody.mimeParts.attachments,
            supabase,
            String(record.id)
          );

          const updateResult = await supabase
            .from("email_messages")
            .update({
              text_body: refreshedBody.text || record.text_body || "(Email received)",
              html_body: refreshedBody.html || record.html_body || null,
              attachments: refreshedAttachments,
              media_processed_at: new Date().toISOString()
            })
            .eq("id", record.id)
            .is("media_processed_at", null)
            .select("id")
            .maybeSingle();

          if (updateResult.error || !updateResult.data?.id) {
            await cleanupStoredEmailAttachments(supabase, refreshedAttachments);
            if (updateResult.error) throw updateResult.error;
            continue;
          }

          existingMediaHydrated += 1;
        }
      } catch (hydrationError) {
        console.error("Unable to backfill existing inbound email media:", hydrationError);
      }
    }

    const backlogRemaining =
      failedUid !== null ||
      allCandidateUids.length > candidateUids.length;

    console.info(
      "Swayphics email inbox sync completed:",
      JSON.stringify({
        uid_validity: uidValidity,
        checked: candidateUids.length,
        newest_uid: newestUid,
        latest_stored_uid: latestStoredUid,
        synced,
        already_stored: alreadyStored,
        existing_media_hydrated: existingMediaHydrated,
        failed_uid: failedUid,
        backlog_remaining: backlogRemaining
      })
    );

    return Response.json(
      {
        success: true,
        provider: "HOSTAFRICA HMailPlus",
        mailbox: MAILBOX,
        uid_validity: uidValidity,
        checked: candidateUids.length,
        newest_uid: newestUid,
        latest_stored_uid: latestStoredUid,
        synced,
        already_stored: alreadyStored,
        existing_media_hydrated: existingMediaHydrated,
        failed_uid: failedUid,
        backlog_remaining: backlogRemaining,
      },
      {
        status: 200,
        headers: corsHeaders
      }
    );
  } catch (error) {
    console.error(
      "Swayphics email inbox sync error:",
      error
    );

    return Response.json(
      {
        error:
          describeImapError(error)
      },
      {
        status: 500,
        headers: corsHeaders
      }
    );
  } finally {
    try {
      mailboxLock?.release();
    } catch {}

    try {
      client?.close();
    } catch {}
  }
});
