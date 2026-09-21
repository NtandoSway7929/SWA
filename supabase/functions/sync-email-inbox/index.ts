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

async function parseEmailSource(source: Uint8Array) {
  try {
    const { default: PostalMime } =
      await import("npm:postal-mime@3.0.0");

    const parsed = await PostalMime.parse(source);

    return {
      subject: cleanHeaderValue(parsed.subject),
      messageId: cleanHeaderValue(parsed.messageId),
      inReplyTo: cleanHeaderValue(parsed.inReplyTo),
      references: cleanHeaderValue(parsed.references),
      date: parsed.date || null,
      text: String(parsed.text || "").trim(),
      html: parsed.html
        ? String(parsed.html)
        : null
    };
  } catch (error) {
    console.warn(
      "PostalMime could not parse the incoming email:",
      error
    );

    return {
      subject: "",
      messageId: "",
      inReplyTo: "",
      references: "",
      date: null,
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
      "mail.privateemail.com";

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
        : newestUid;

    let candidateUids =
      await client.search(
        {
          uid:
            String(startUid) +
            ":*"
        },
        {
          uid: true
        }
      );

    if (!Array.isArray(candidateUids)) {
      candidateUids = [];
    }

    const targetUid =
      candidateUids[0] || 0;

    let synced = 0;

    if (targetUid) {
      const message =
        await client.fetchOne(
          targetUid,
          {
            envelope: true,
            internalDate: true,
            source: {
              start: 0,
              maxLength: 262144
            }
          },
          {
            uid: true
          }
        );

      if (message?.source) {
        const parsed =
          await parseEmailSource(
            message.source
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
            envelope.messageId ||
            parsed.messageId
          ) || null;

        const inReplyTo =
          cleanHeaderValue(
            envelope.inReplyTo ||
            parsed.inReplyTo
          ) || null;

        const references =
          cleanHeaderValue(
            parsed.references
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

        let textBody =
          parsed.text || "";

        if (
          !textBody &&
          parsed.html
        ) {
          textBody =
            stripHtml(
              parsed.html
            );
        }

        if (
          !textBody &&
          message.source
        ) {
          const sourceText =
            new TextDecoder()
              .decode(
                message.source
              );

          const bodyStart =
            sourceText.search(
              /\r?\n\r?\n/
            );

          if (bodyStart >= 0) {
            textBody =
              decodeMimeText(
                sourceText.slice(
                  bodyStart + 2
                ),
                ""
              ).trim();
          }
        }

        const fallbackDate =
          message.internalDate
            instanceof Date
            ? message.internalDate
            : new Date();

        const receivedAt =
          parsed.date
            ? new Date(
                String(parsed.date)
              ).toISOString()
            : fallbackDate.toISOString();

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
                parsed.html || null,
              received_at:
                receivedAt,
              is_read: false,
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
          synced = 1;

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
      }
    }

    return Response.json(
      {
        success: true,
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
