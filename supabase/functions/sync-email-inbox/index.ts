import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@2.0.5";
import PostalMime from "npm:postal-mime@3.0.0";

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

  if (!address) {
    return {
      name: "",
      email: ""
    };
  }

  return {
    name:
      String(address.name || "").trim(),
    email:
      String(
        address.address ||
        address.email ||
        ""
      ).trim().toLowerCase()
  };
}

function messageIds(value: unknown) {
  return (
    String(value || "")
      .match(/<[^>]+>/g) ||
    []
  );
}

function cleanHeaderValue(value: unknown) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function describeImapError(error: unknown) {
  const value = error as any;
  const responseText =
    value?.responseText ||
    value?.response?.responseText ||
    value?.response?.text ||
    value?.response?.attributes?.find?.((item: any) => item?.type === "TEXT")?.value ||
    "";

  const responseStatus =
    value?.responseStatus ||
    value?.response?.command ||
    "";

  const serverResponseCode =
    value?.serverResponseCode ||
    value?.response?.code ||
    "";

  const command =
    value?.executedCommand ||
    value?.command ||
    "";

  if (value?.authenticationFailed) {
    return "IMAP authentication failed. Check EMAIL_IMAP_PASSWORD for the Namecheap mailbox.";
  }

  const parts = [
    responseText || value?.message || "Unable to synchronize the Swayphics inbox.",
    responseStatus ? "status=" + String(responseStatus) : "",
    serverResponseCode ? "code=" + String(serverResponseCode) : "",
    command ? "command=" + String(command) : ""
  ].filter(Boolean);

  return parts.join(" | ");
}

function safeReceivedAt(
  value: unknown,
  fallback: Date
) {
  const parsed =
    new Date(
      String(value || "")
    );

  if (
    !Number.isNaN(
      parsed.getTime()
    )
  ) {
    return parsed.toISOString();
  }

  return fallback.toISOString();
}

async function findExistingThread(
  supabase: any,
  candidates: string[]
) {
  if (!candidates.length) {
    return null;
  }

  const result =
    await supabase
      .from("email_messages")
      .select("thread_id")
      .in(
        "message_id",
        candidates
      )
      .limit(1);

  if (result.error) {
    throw result.error;
  }

  return (
    result.data?.[0]?.thread_id ||
    null
  );
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

  const normalized =
    email.toLowerCase();

  const clientResult =
    await supabase
      .from("clients")
      .select("id")
      .ilike(
        "email",
        normalized
      )
      .limit(1);

  if (
    clientResult.data?.[0]?.id
  ) {
    return {
      clientId:
        clientResult.data[0].id,
      leadId: null
    };
  }

  const leadResult =
    await supabase
      .from("leads")
      .select("id")
      .ilike(
        "email",
        normalized
      )
      .limit(1);

  if (
    leadResult.data?.[0]?.id
  ) {
    return {
      clientId: null,
      leadId:
        leadResult.data[0].id
    };
  }

  return {
    clientId: null,
    leadId: null
  };
}

Deno.serve(async (req) => {
  if (
    req.method === "OPTIONS"
  ) {
    return new Response(
      "ok",
      {
        headers:
          corsHeaders
      }
    );
  }

  if (
    req.method !== "POST"
  ) {
    return Response.json(
      {
        error:
          "Method not allowed."
      },
      {
        status: 405,
        headers:
          corsHeaders
      }
    );
  }

  let client: any = null;
  let mailboxLock: any = null;

  try {
    const authorization =
      req.headers.get(
        "Authorization"
      ) ||
      req.headers.get(
        "authorization"
      );

    const accessToken =
      authorization?.replace(
        /^Bearer\s+/i,
        ""
      );

    if (!accessToken) {
      return Response.json(
        {
          error:
            "Authentication required."
        },
        {
          status: 401,
          headers:
            corsHeaders
        }
      );
    }

    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL"
      );

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );

    const publicApiKey =
      req.headers.get(
        "apikey"
      ) ||
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      ) ||
      Deno.env.get(
        "SUPABASE_PUBLISHABLE_KEY"
      );

    const imapPassword =
      Deno.env.get(
        "EMAIL_IMAP_PASSWORD"
      );

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
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
          headers:
            corsHeaders
        }
      );
    }

    const authSupabase =
      createClient(
        supabaseUrl,
        publicApiKey
      );

    const userData =
      await authSupabase
        .auth
        .getUser(
          accessToken
        );

    if (
      userData.error ||
      !userData.data?.user
    ) {
      return Response.json(
        {
          error:
            "Your admin session is invalid or expired."
        },
        {
          status: 401,
          headers:
            corsHeaders
        }
      );
    }

    const supabase =
      createClient(
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

    const limit =
      Math.min(
        Math.max(
          Number(
            Deno.env.get(
              "EMAIL_IMAP_LIMIT"
            ) ||
            "25"
          ) || 100,
          1
        ),
        200
      );

    client =
      new ImapFlow({
        host:
          imapHost,
        port:
          imapPort,
        secure: true,
        logger: false,
        disableCompression: true,
        disableAutoIdle: true,
        auth: {
          user:
            imapUser,
          pass:
            imapPassword
        }
      });

    await client.connect();

    mailboxLock =
      await client.getMailboxLock(
        folder,
        {
          readOnly: true,
          description: "Swayphics inbox sync"
        }
      );

    const exists =
      Number(
        client.mailbox?.exists ||
        0
      );

    if (exists === 0) {
      return Response.json(
        {
          success: true,
          synced: 0,
          unread: 0
        },
        {
          status: 200,
          headers:
            corsHeaders
        }
      );
    }

    // IMAP message count (exists) is not the same thing as the UID sequence.,    // Use uidNext so we only request actual UID ranges.,    const uidNext =,      Number(client.mailbox?.uidNext || 0);,,    const newestUid =,      Math.max(0, uidNext - 1);,,    if (!newestUid) {,      const unreadEmptyResult =,        await supabase,          .from("email_messages"),          .select("id", {,            count: "exact",,            head: true,          }),          .eq("direction", "inbound"),          .eq("is_read", false);,,      return Response.json(,        {,          success: true,,          synced: 0,,          unread:,            unreadEmptyResult.count ||,            0,        },,        {,          status: 200,,          headers:,            corsHeaders,        },      );,    },,    const latestStoredResult =,      await supabase,        .from("email_messages"),        .select("imap_uid"),        .eq("mailbox", MAILBOX),        .not("imap_uid", "is", null),        .order("imap_uid", { ascending: false }),        .limit(1);,,    if (latestStoredResult.error) {,      throw latestStoredResult.error;,    },,    const latestStoredUid =,      Number(latestStoredResult.data?.[0]?.imap_uid || 0);,,    let firstUid;,,    if (latestStoredUid > 0) {,      firstUid = latestStoredUid + 1;,    } else {,      // First run: import only the latest message rather than walking the mailbox.,      firstUid = newestUid;,    },,    if (firstUid > newestUid) {,      const unreadCurrentResult =,        await supabase,          .from("email_messages"),          .select("id", {,            count: "exact",,            head: true,          }),          .eq("direction", "inbound"),          .eq("is_read", false);,,      return Response.json(,        {,          success: true,,          synced: 0,,          unread:,            unreadCurrentResult.count ||,            0,        },,        {,          status: 200,,          headers:,            corsHeaders,        },      );,    },,    // Process exactly one UID per invocation to stay comfortably below the,    // Edge Function CPU/memory budget.,    const targetUid =,      Math.min(firstUid, newestUid);,,    const message =,      await client.fetchOne(,        targetUid,,        {,          envelope: true,,          internalDate: true,,          source: {,            start: 0,,            maxLength: 262144,          },        },,        {,          uid: true,        },      );,,    let synced = 0;,,    if (message && message.source) {,      const uid =,        Number(message.uid);,,      const sourceKey =,        "imap:" +,        folder +,        ":" +,        String(uid);,,      const existingBySource =,        await supabase,          .from("email_messages"),          .select("id"),          .eq("source_key", sourceKey),          .limit(1);,,      if (!existingBySource.error && !existingBySource.data?.length) {,        let parsed: any = null;,,        try {,          parsed =,            await PostalMime.parse(,              message.source,            );,        } catch (parseError) {,          console.warn(,            "Email MIME parsing failed; using IMAP envelope only:",,            parseError,          );,        },,        const envelope =,          message.envelope || {};,,        const from =,          firstAddress(,            envelope.from ||,            parsed?.from,          );,,        const to =,          firstAddress(,            envelope.to ||,            parsed?.to,          );,,        const subject =,          cleanHeaderValue(,            envelope.subject ||,            parsed?.subject ||,            "No subject",          );,,        const messageId =,          cleanHeaderValue(,            envelope.messageId ||,            parsed?.messageId,          ) || null;,,        const inReplyTo =,          cleanHeaderValue(,            envelope.inReplyTo ||,            parsed?.inReplyTo,          ) || null;,,        const references =,          cleanHeaderValue(,            parsed?.references,          ) || null;,,        const candidates =,          Array.from(,            new Set([,              ...messageIds(inReplyTo),,              ...messageIds(references),,              ...(messageId,                ? [messageId],                : []),            ]),          );,,        let threadId =,          await findExistingThread(,            supabase,,            candidates,          );,,        if (!threadId) {,          threadId =,            candidates[0] ||,            messageId ||,            sourceKey;,        },,        const fallbackDate =,          message.internalDate instanceof Date,            ? message.internalDate,            : new Date();,,        const receivedAt =,          safeReceivedAt(,            parsed?.date ||,            envelope.date ||,            message.internalDate,,            fallbackDate,          );,,        const textBody =,          String(,            parsed?.text ||,            "",          ).trim();,,        const htmlBody =,          parsed?.html,            ? String(parsed.html),            : null;,,        const contact =,          await findContact(,            supabase,,            from.email,          );,,        const inserted =,          await supabase,            .from("email_messages"),            .insert({,              direction: "inbound",,              mailbox: MAILBOX,,              source_key: sourceKey,,              imap_uid: uid,,              external_id: null,,              message_id: messageId,,              in_reply_to: inReplyTo,,              references_header: references,,              thread_id: threadId,,              from_name: from.name || null,,              from_email: from.email || null,,              to_email: to.email || MAILBOX,,              subject: subject || null,,              text_body:,                textBody || subject || "(Email received)",,              html_body: htmlBody,,              received_at: receivedAt,,              is_read: false,,              client_id: contact.clientId,,              lead_id: contact.leadId,,              created_by: null,            }),            .select("id"),            .single();,,        if (inserted.error) {,          if (inserted.error.code !== "23505") {,            throw inserted.error;,          },        } else {,          synced = 1;,,          if (contact.clientId || contact.leadId) {,            const logResult =,              await supabase,                .from("communication_logs"),                .insert({,                  client_id: contact.clientId,,                  lead_id: contact.leadId,,                  channel: "Email",,                  direction: "inbound",,                  subject: subject || null,,                  message:,                    textBody || subject || "(Email received)",,                  contacted_at: receivedAt,,                  created_by: null,                });,,            if (logResult.error) {,              console.error(,                "Inbound communication log insert failed:",,                logResult.error,              );,            },          },        },      },    },,    const unreadResult =
      await supabase
        .from("email_messages")
        .select(
          "id",
          {
            count: "exact",
            head: true
          }
        )
        .eq(
          "direction",
          "inbound"
        )
        .eq(
          "is_read",
          false
        );

    return Response.json(
      {
        success: true,
        synced,
        unread:
          unreadResult.count ||
          0
      },
      {
        status: 200,
        headers:
          corsHeaders
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
        headers:
          corsHeaders
      }
    );
  } finally {
    try {
      mailboxLock?.release();
    } catch {}

    try {
      await client?.logout();
    } catch {}
  }
});
