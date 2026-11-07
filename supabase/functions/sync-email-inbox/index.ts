import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@2.0.5";
import {
  getSyncStartUid,
  resolveMatchingThreadMessage,
  selectUidBatch,
} from "./inbox-helpers.mjs";
import {
  collectEmailMimeParts,
  sanitizeEmailFilename,
} from "./email-mime-helpers.mjs";

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
const MAX_SOURCE_LENGTH = 32768;
const EMAIL_ATTACHMENT_BUCKET = "swayphics-email-attachments";
const MAX_EMAIL_BODY_BYTES = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_STORED_ATTACHMENTS = 12;
const EXISTING_MEDIA_BACKFILL_BATCH = 6;

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

function decodeMimeText(value: string, encoding: string) {
  const normalizedEncoding = String(encoding || "").toLowerCase();

  if (normalizedEncoding === "base64") {
    try {
      return atob(
        value
          .replace(/\s+/g, "")
          .replace(/-/g, "+")
          .replace(/_/g, "/")
      );
    } catch {
      return value;
    }
  }

  if (
    normalizedEncoding === "quoted-printable" ||
    normalizedEncoding === "quopri"
  ) {
    return value
      .replace(/=\r?\n/g, "")
      .replace(
        /=([0-9A-Fa-f]{2})/g,
        function (_match, hex) {
          return String.fromCharCode(
            parseInt(hex, 16)
          );
        }
      );
  }

  return value;
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

async function downloadMimePartBytes(
  imapClient: any,
  uid: number,
  part: any,
  maxBytes: number
): Promise<Uint8Array> {
  if (!part?.part) {
    throw new Error("The email MIME part does not have a downloadable part identifier.");
  }

  const expectedSize = Number(part.size || 0);
  if (expectedSize > maxBytes) {
    throw new Error("The email MIME part exceeds the permitted download size.");
  }

  const downloaded = await imapClient.download(
    uid,
    String(part.part),
    {
      uid: true,
      maxBytes
    }
  );

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of downloaded.content) {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : new Uint8Array(chunk);
    totalLength += bytes.byteLength;
    if (totalLength > maxBytes) {
      throw new Error("The email MIME part exceeds the permitted download size.");
    }
    chunks.push(bytes);
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function decodeMimeTextPart(
  imapClient: any,
  uid: number,
  part: any
): Promise<string> {
  if (!part?.part) return "";
  const bytes = await downloadMimePartBytes(
    imapClient,
    uid,
    part,
    MAX_EMAIL_BODY_BYTES
  );
  const charset = String(part.parameters?.charset || "utf-8");
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

async function fetchMessageBody(
  imapClient: any,
  uid: number,
  bodyStructure: any
) {
  const parts = collectEmailMimeParts(bodyStructure);
  const plainText = parts.plain
    ? await decodeMimeTextPart(imapClient, uid, parts.plain)
    : "";
  const html = parts.html
    ? await decodeMimeTextPart(imapClient, uid, parts.html)
    : null;

  return {
    text: plainText.trim() || (html ? stripHtml(html) : ""),
    html: html || null,
    mimeParts: parts
  };
}

function attachmentStoragePath(messageRecordId: string, part: any) {
  const partKey = String(part.part || "part")
    .replace(/[^0-9.]/g, "_")
    .replace(/\.+/g, "-");
  const filename = sanitizeEmailFilename(part.filename);
  return messageRecordId + "/" + partKey + "-" + filename;
}

async function storeEmailAttachments(
  imapClient: any,
  uid: number,
  mimeAttachments: any[],
  supabase: any,
  messageRecordId: string
) {
  const stored: any[] = [];
  const uploadedPaths: string[] = [];
  let totalStoredBytes = 0;

  for (const descriptor of (Array.isArray(mimeAttachments) ? mimeAttachments : [])
    .slice(0, MAX_STORED_ATTACHMENTS)) {
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

    if (Number(descriptor.sizeBytes || 0) > MAX_ATTACHMENT_BYTES) {
      entry.status = "too_large";
      stored.push(entry);
      continue;
    }
    if (totalStoredBytes >= MAX_TOTAL_ATTACHMENT_BYTES) {
      entry.status = "storage_limit";
      stored.push(entry);
      continue;
    }

    const availableBytes = Math.min(
      MAX_ATTACHMENT_BYTES,
      MAX_TOTAL_ATTACHMENT_BYTES - totalStoredBytes
    );

    try {
      const bytes = await downloadMimePartBytes(
        imapClient,
        uid,
        { part: descriptor.part, size: descriptor.sizeBytes },
        availableBytes
      );

      if (!bytes.byteLength) {
        entry.status = "empty";
        stored.push(entry);
        continue;
      }

      const storagePath = attachmentStoragePath(messageRecordId, descriptor);
      const uploadResult = await supabase.storage
        .from(EMAIL_ATTACHMENT_BUCKET)
        .upload(storagePath, bytes, {
          contentType: String(descriptor.contentType || "application/octet-stream"),
          cacheControl: "3600",
          upsert: true
        });

      if (uploadResult.error) {
        throw uploadResult.error;
      }

      uploadedPaths.push(storagePath);
      totalStoredBytes += bytes.byteLength;
      entry.size_bytes = bytes.byteLength;
      entry.storage_path = storagePath;
      entry.status = "stored";
    } catch (error) {
      if (String((error as any)?.message || "").toLowerCase().includes("permitted download size")) {
        entry.status = "too_large";
      } else {
        // Do not commit partial attachment state. The caller will retry the
        // message on the next scheduled or authenticated inbox sync.
        if (uploadedPaths.length) {
          await supabase.storage.from(EMAIL_ATTACHMENT_BUCKET).remove(uploadedPaths);
        }
        throw error;
      }
    }

    stored.push(entry);
  }

  for (const descriptor of (Array.isArray(mimeAttachments) ? mimeAttachments : []).slice(MAX_STORED_ATTACHMENTS)) {
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
    .select("id,attachments,media_processed_at")
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
      auth: {
        user: imapUser,
        pass: imapPassword
      }
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

    for (const targetUid of candidateUids) {
      try {
        const message =
          await client.fetchOne(
            targetUid,
            {
              envelope: true,
              internalDate: true,
              flags: true,
              bodyStructure: true
            },
            {
              uid: true
            }
          );

        if (!message) {
          failedUid = targetUid;
          break;
        }

        const body =
          await fetchMessageBody(
            client,
            targetUid,
            message.bodyStructure
          );

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

          const existingAttachments = Array.isArray(existingInbound.attachments)
            ? existingInbound.attachments
            : [];
          const mediaAlreadyProcessed = Boolean(existingInbound.media_processed_at);
          const hydratedAttachments = mediaAlreadyProcessed
            ? existingAttachments
            : await storeEmailAttachments(
                client,
                targetUid,
                body.mimeParts.attachments,
                supabase,
                String(existingInbound.id)
              );

          const updatedExisting =
            await supabase
              .from("email_messages")
              .update({
                imap_uid: Number(targetUid),
                imap_uid_validity: uidValidity,
                source_key: existingSourceKey,
                ...(mediaAlreadyProcessed ? {} : {
                  text_body: body.text || subject || "(Email received)",
                  html_body: body.html || null,
                  attachments: hydratedAttachments,
                  media_processed_at: new Date().toISOString()
                })
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

        const textBody =
          body.text ||
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
        const attachmentMetadata = await storeEmailAttachments(
          client,
          targetUid,
          body.mimeParts.attachments,
          supabase,
          emailRecordId
        );

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
              html_body:
                body.html || null,
              attachments: attachmentMetadata,
              media_processed_at: new Date().toISOString(),
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
          await cleanupStoredEmailAttachments(supabase, attachmentMetadata);
          if (
            inserted.error.code !==
            "23505"
          ) {
            throw inserted.error;
          }
        } else {
          synced += 1;

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
          .select("id,imap_uid,imap_uid_validity,message_id,media_processed_at")
          .eq("mailbox", MAILBOX)
          .eq("direction", "inbound")
          .eq("imap_uid_validity", uidValidity)
          .is("media_processed_at", null)
          .not("imap_uid", "is", null)
          .order("received_at", { ascending: false })
          .limit(EXISTING_MEDIA_BACKFILL_BATCH);

        if (pendingMedia.error) throw pendingMedia.error;

        for (const record of pendingMedia.data || []) {
          const storedUid = Number(record.imap_uid);
          if (!Number.isSafeInteger(storedUid) || storedUid <= 0 || !record.message_id) continue;

          const storedMessage = await client.fetchOne(
            storedUid,
            { envelope: true, bodyStructure: true },
            { uid: true }
          );

          const liveMessageId = cleanHeaderValue(storedMessage?.envelope?.messageId || "");
          if (!storedMessage || liveMessageId !== String(record.message_id).trim()) {
            continue;
          }

          const refreshedBody = await fetchMessageBody(
            client,
            storedUid,
            storedMessage.bodyStructure
          );

          const refreshedAttachments = await storeEmailAttachments(
            client,
            storedUid,
            refreshedBody.mimeParts.attachments,
            supabase,
            String(record.id)
          );

          const updateResult = await supabase
            .from("email_messages")
            .update({
              text_body: refreshedBody.text || "(Email received)",
              html_body: refreshedBody.html || null,
              attachments: refreshedAttachments,
              media_processed_at: new Date().toISOString()
            })
            .eq("id", record.id)
            .is("media_processed_at", null);

          if (updateResult.error) {
            await cleanupStoredEmailAttachments(supabase, refreshedAttachments);
            throw updateResult.error;
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
