import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@2.0.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

const MAILBOX = "info@swayphics.co.za";

const INITIAL_SYNC_LIMIT = 10;
const MAX_MESSAGES_PER_SYNC = 2;
const MAX_SOURCE_LENGTH = 32768;

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

function findMimePart(node: any, types: string[]) {
  if (!node) return null;

  const nodeType =
    String(node.type || "").toLowerCase();

  if (types.includes(nodeType)) {
    return node;
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      const match = findMimePart(child, types);
      if (match) return match;
    }
  }

  return null;
}

function decodeMimeBody(value: string, encoding: string) {
  const normalizedEncoding =
    String(encoding || "").toLowerCase();

  if (normalizedEncoding === "base64") {
    try {
      const binary = atob(
        value
          .replace(/\s+/g, "")
          .replace(/-/g, "+")
          .replace(/_/g, "/")
      );

      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      return new TextDecoder().decode(bytes);
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
          return String.fromCharCode(parseInt(hex, 16));
        }
      );
  }

  return value;
}

async function fetchMessageBody(
  client: any,
  uid: number,
  bodyStructure: any
) {
  const plainPart =
    findMimePart(bodyStructure, ["text/plain"]);

  const htmlPart =
    findMimePart(bodyStructure, ["text/html"]);

  const part = plainPart || htmlPart;

  if (!part?.part) {
    return { text: "", html: null };
  }

  try {
    const downloaded =
      await client.download(
        uid,
        String(part.part),
        {
          uid: true,
          maxBytes: 32768
        }
      );

    const chunks = [];

    for await (const chunk of downloaded.content) {
      chunks.push(chunk);
    }

    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }

    const bytes = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    const raw = new TextDecoder().decode(bytes);
    const decoded = decodeMimeBody(
      raw,
      String(part.encoding || "")
    );

    if (plainPart) {
      return {
        text: decoded.trim(),
        html: null
      };
    }

    return {
      text: stripHtml(decoded),
      html: decoded
    };
  } catch (error) {
    console.warn(
      "Unable to fetch inbound email body:",
      error
    );

    return {
      text: "",
      html: null
    };
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
    .select("thread_id")
    .in("message_id", candidates)
    .limit(1);

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0]?.thread_id || null;
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

    const userResult =
      await authSupabase.auth.getUser(
        accessToken
      );

    if (
      userResult.error ||
      !userResult.data?.user
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

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey
    );

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

    const uidNext =
      Number(
        client.mailbox?.uidNext || 0
      );

    const newestUid =
      Math.max(0, uidNext - 1);

    if (!newestUid) {
      return Response.json(
        {
          success: true,
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

    const startUid =
      latestStoredUid > 0
        ? latestStoredUid + 1
        : Math.max(
            1,
            newestUid - INITIAL_SYNC_LIMIT + 1
          );

    let candidateUids =
      await client.search(
        {
          uid:
            String(startUid) +
            ":" +
            String(newestUid)
        },
        {
          uid: true
        }
      );

    if (!Array.isArray(candidateUids)) {
      candidateUids = [];
    }

    candidateUids = candidateUids
      .map((uid) => Number(uid))
      .filter(
        (uid) =>
          Number.isFinite(uid) &&
          uid > 0
      )
      .sort((a, b) => a - b)
      .slice(0, MAX_MESSAGES_PER_SYNC);

    let synced = 0;

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
          continue;
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
            parsed.subject ||
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

        let threadId =
          await findExistingThread(
            supabase,
            candidates
          );

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

        const contact =
          await findContact(
            supabase,
            fromEmail
          );

        const sourceKey =
          "imap:" +
          folder +
          ":" +
          String(targetUid);

        const inserted =
          await supabase
            .from("email_messages")
            .insert({
              direction: "inbound",
              mailbox: MAILBOX,
              source_key: sourceKey,
              imap_uid:
                Number(targetUid),
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
      }
    }

    return Response.json(
      {
        success: true,
        provider: "HOSTAFRICA HMailPlus",
        mailbox: MAILBOX,
        checked: candidateUids.length,
        newest_uid: newestUid,
        latest_stored_uid: latestStoredUid,
        synced
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
