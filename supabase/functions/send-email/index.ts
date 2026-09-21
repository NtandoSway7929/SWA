import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  contact_type?: "client" | "lead";
  contact_id?: string;
  recipient_email?: string;
  subject?: string;
  message?: string;
  in_reply_to?: string;
  references?: string;
  thread_id?: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanEmailHeader(value: unknown, maxLength = 1800) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function emailParagraphs(value: string) {
  return String(value || "")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        '<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#56627A;">' +
        escapeHtml(paragraph).replaceAll("\n", "<br>") +
        "</p>",
    )
    .join("");
}

function cleanRecipientName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function brandedEmailHtml(
  recipientName: string,
  businessName: string,
  message: string,
) {
  const normalizedRecipientName =
    cleanRecipientName(recipientName);

  const normalizedBusinessName =
    cleanRecipientName(businessName);

  /*
   * A saved contact person must always take precedence over the business
   * name. The generic "Hello," greeting is only used when neither value
   * exists.
   */
  const greetingName =
    normalizedRecipientName.length > 0
      ? normalizedRecipientName
      : normalizedBusinessName;

  const greetingMarkup =
    greetingName.length > 0
      ? "Hi " + escapeHtml(greetingName) + ","
      : "Hello,";
  return `<!doctype html>
<html>
<body style="margin:0;background:#F4F7FC;font-family:Arial,Helvetica,sans-serif;color:#081533;">
  <div style="max-width:700px;margin:0 auto;padding:32px 18px;">
    <div style="background:#FFFFFF;border:1px solid #E0E6F0;border-radius:22px;overflow:hidden;box-shadow:0 12px 35px rgba(0,32,150,.07);">
      <div style="padding:25px 30px;background:#FFFFFF;border-bottom:1px solid #E7ECF4;">
        <img
          src="https://swayphics.co.za/swayphics-logo.png"
          alt="Swayphics"
          width="145"
          style="display:block;width:145px;height:auto;"
        />
      </div>

      <div style="padding:34px 30px 26px;">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#56627A;">
          ${greetingMarkup}
        </p>

        ${emailParagraphs(message)}

        <p style="margin:24px 0 0;font-size:15px;line-height:1.8;color:#56627A;">
          Kind Regards,<br>
          <strong style="color:#081533;">Swayphics</strong>
        </p>
      </div>

      <div style="padding:18px 30px;background:#F7FAFF;border-top:1px solid #E7ECF4;color:#7A899D;font-size:11px;line-height:1.75;">
        <strong style="color:#081533;">Swayphics</strong><br>
        info@swayphics.co.za · <a href="https://swayphics.co.za" style="color:#0152F4;text-decoration:none;">swayphics.co.za</a>
        <div style="margin-top:9px;">
          <a href="https://swayphics.co.za/privacy-policy/" style="color:#56627A;text-decoration:underline;">Privacy Policy</a>
          <span style="padding:0 6px;color:#B4BFCE;">·</span>
          <a href="https://swayphics.co.za/terms-and-conditions/" style="color:#56627A;text-decoration:underline;">Terms &amp; Conditions</a>
        </div>
        <div style="margin-top:9px;color:#8A97A8;">
          © 2026 Swayphics. All rights reserved.
        </div>
        <div style="margin-top:7px;color:#8A97A8;">
          This email and any attachments are intended only for the addressed recipient. If you received this in error, please notify the sender and delete it.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  try {
    const authorization =
      req.headers.get("Authorization") ||
      req.headers.get("authorization");

    const accessToken =
      authorization?.replace(
        /^Bearer\s+/i,
        "",
      );

    if (!accessToken) {
      return Response.json(
        { error: "Authentication required." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const body: EmailRequest =
      await req.json();

    const contactType =
      body.contact_type === "lead"
        ? "lead"
        : body.contact_type === "client"
          ? "client"
          : null;

    const rawContactId =
      String(body.contact_id || "").trim();

    const contactId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        rawContactId,
      )
        ? rawContactId
        : "";

    const rawRecipient =
      String(body.recipient_email || "").trim();

    const emailMatch =
      rawRecipient.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      );

    const requestedRecipientEmail =
      String(
        emailMatch?.[0] || rawRecipient,
      )
        .trim()
        .toLowerCase();

    const message =
      String(body.message || "").trim();

    if (
      !contactType ||
      (!contactId && !requestedRecipientEmail)
    ) {
      return Response.json(
        { error: "A lead or client recipient is required." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    if (message.length < 2) {
      return Response.json(
        { error: "Email message is required." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    if (message.length > 10000) {
      return Response.json(
        { error: "Email message is too long." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase server configuration is missing.",
      );
    }

    if (!resendApiKey) {
      return Response.json(
        {
          error:
            "Email sending is not configured yet. Add RESEND_API_KEY to your Supabase Edge Function secrets.",
        },
        {
          status: 503,
          headers: corsHeaders,
        },
      );
    }

    const publicApiKey =
      req.headers.get("apikey") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!publicApiKey) {
      throw new Error(
        "Supabase public API key is missing.",
      );
    }

    const authSupabase =
      createClient(
        supabaseUrl,
        publicApiKey,
        {
          global: {
            headers: {
              Authorization:
                "Bearer " + accessToken,
            },
          },
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        },
      );

    const {
      data: userData,
      error: userError,
    } =
      await authSupabase.auth.getUser(
        accessToken,
      );

    if (userError || !userData.user) {
      return Response.json(
        { error: "Your session is no longer valid." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: isAdmin,
      error: adminError,
    } =
      await authSupabase.rpc(
        "is_swayphics_admin",
      );

    if (adminError || isAdmin !== true) {
      return Response.json(
        {
          error:
            "You are not an active Swayphics admin.",
        },
        {
          status: 403,
          headers: corsHeaders,
        },
      );
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        },
      );

    const columns =
      "id,business_name,contact_name,email";

    let contact: {
      id: string;
      business_name?: string | null;
      contact_name?: string | null;
      email?: string | null;
    } | null = null;

    let resolvedContactType =
      contactType;

    let contactError: unknown = null;

    const lookupTable =
      async (
        tableName: "leads" | "clients",
      ) => {
        if (contactId) {
          const byId =
            await supabase
              .from(tableName)
              .select(columns)
              .eq("id", contactId)
              .maybeSingle();

          if (byId.data) {
            return {
              contact: byId.data,
              error: byId.error || null,
              type:
                tableName === "clients"
                  ? "client"
                  : "lead",
            };
          }

          contactError =
            byId.error || contactError;
        }

        if (requestedRecipientEmail) {
          const byEmail =
            await supabase
              .from(tableName)
              .select(columns)
              .ilike("email", requestedRecipientEmail)
              .maybeSingle();

          if (byEmail.data) {
            return {
              contact: byEmail.data,
              error: byEmail.error || null,
              type:
                tableName === "clients"
                  ? "client"
                  : "lead",
            };
          }

          contactError =
            byEmail.error || contactError;
        }

        return null;
      };

    const primaryTable =
      contactType === "lead"
        ? "leads"
        : "clients";

    const secondaryTable =
      primaryTable === "leads"
        ? "clients"
        : "leads";

    const primaryLookup =
      await lookupTable(primaryTable);

    const secondaryLookup =
      primaryLookup ||
      await lookupTable(secondaryTable);

    if (secondaryLookup) {
      contact =
        secondaryLookup.contact;
      resolvedContactType =
        secondaryLookup.type;
    }

    /*
     * The dashboard already supplies the recipient email from the selected
     * lead/client. Resolve the record when possible for auditing and
     * communication logging, but do not block a legitimate admin send merely
     * because the contact row cannot be resolved at that exact moment.
     */
    if (!contact && requestedRecipientEmail) {
      contact = {
        id: contactId || "",
        business_name: "",
        contact_name: "",
        email: requestedRecipientEmail,
      };
    }

    if (!contact) {
      console.error(
        "Recipient lookup failed and no usable recipient email was supplied:",
        {
          requested_contact_type: contactType,
          contact_id: contactId,
          recipient_email: requestedRecipientEmail,
          error: contactError,
        },
      );

      throw new Error(
        "A valid recipient email address is required to send this message.",
      );
    }

    const recipientName =
      cleanRecipientName(
        contact.contact_name,
      );

    const recipientBusinessName =
      cleanRecipientName(
        contact.business_name,
      );

    console.log(
      "Swayphics email recipient resolved:",
      {
        contact_type: resolvedContactType,
        contact_id: contact.id || null,
        contact_name: recipientName,
        business_name: recipientBusinessName,
        recipient_email: contact.email || requestedRecipientEmail,
      },
    );

    const recipientEmail =
      String(
        contact.email ||
        requestedRecipientEmail ||
        "",
      ).trim().toLowerCase();

    if (!recipientEmail) {
      return Response.json(
        {
          error:
            "The selected contact does not have an email address.",
        },
        {
          status: 422,
          headers: corsHeaders,
        },
      );
    }

    if (
      requestedRecipientEmail &&
      contact.email &&
      recipientEmail !==
        requestedRecipientEmail
    ) {
      throw new Error(
        "The selected recipient email does not match the saved contact. Refresh the dashboard and select the recipient again.",
      );
    }

    const subject =
      String(body.subject || "").trim() ||
      (
        "Swayphics | " +
        String(
          contact.business_name ||
          "Business correspondence",
        ).trim()
      );

    if (subject.length > 180) {
      return Response.json(
        { error: "Email subject is too long." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") ||
      "Swayphics <info@swayphics.co.za>";

    const replyTo =
      "info@swayphics.co.za";

    const inReplyTo =
      cleanEmailHeader(body.in_reply_to, 998) || null;

    const referencesHeader =
      cleanEmailHeader(body.references, 1800) || null;

    const threadId =
      cleanEmailHeader(body.thread_id, 500) || null;

    const emailHeaders: Record<string, string> = {};

    if (inReplyTo) {
      emailHeaders["In-Reply-To"] = inReplyTo;
    }

    if (referencesHeader) {
      emailHeaders["References"] = referencesHeader;
    }

    const emailResponse =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization:
              "Bearer " + resendApiKey,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [recipientEmail],
            reply_to: replyTo,
            subject,
            ...(Object.keys(emailHeaders).length
              ? { headers: emailHeaders }
              : {}),
            html:
              brandedEmailHtml(
                recipientName,
                recipientBusinessName,
                message,
              ),
          }),
        },
      );

    const responseText =
      await emailResponse.text();

    let result: any = {};

    try {
      result =
        responseText
          ? JSON.parse(responseText)
          : {};
    } catch {
      result = {
        raw: responseText,
      };
    }

    if (!emailResponse.ok) {
      const messageText =
        result?.message ||
        result?.error?.message ||
        responseText ||
        "Email provider rejected the request.";

      throw new Error(
        String(messageText),
      );
    }

    const emailId =
      result?.id ||
      null;

    let resendMessageId =
      cleanEmailHeader(
        result?.message_id,
        998
      ) || null;

    if (emailId && !resendMessageId) {
      try {
        const retrieveResponse =
          await fetch(
            "https://api.resend.com/emails/" +
            encodeURIComponent(emailId),
            {
              method: "GET",
              headers: {
                Authorization:
                  "Bearer " +
                  resendApiKey
              }
            }
          );

        if (retrieveResponse.ok) {
          const retrievedEmail =
            await retrieveResponse.json();

          resendMessageId =
            cleanEmailHeader(
              retrievedEmail?.message_id,
              998
            ) || null;
        }
      } catch (retrieveError) {
        console.warn(
          "Unable to retrieve Resend Message-ID after sending:",
          retrieveError
        );
      }
    }

    const canLogContact =
      Boolean(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(contact.id || ""),
        ),
      );

    let communicationInsert =
      canLogContact
        ? await supabase
            .from("communication_logs")
            .insert({
              client_id:
                resolvedContactType === "client"
                  ? contact.id
                  : null,
              lead_id:
                resolvedContactType === "lead"
                  ? contact.id
                  : null,
              channel: "Email",
              direction: "outbound",
              subject,
              message,
              contacted_at:
                new Date().toISOString(),
              created_by:
                userData.user.id,
            })
        : {
            error: {
              message:
                "The email was sent, but the selected contact record could not be resolved for communication logging.",
            },
          };

    // Retry once using the normalized contact type. This protects against
    // stale client/lead selections after a contact has been converted.
    if (communicationInsert.error && canLogContact) {
      const retryPayload =
        resolvedContactType === "client"
          ? {
              client_id: contact.id,
              lead_id: null,
              channel: "Email",
              direction: "outbound",
              subject,
              message,
              contacted_at:
                new Date().toISOString(),
              created_by:
                userData.user.id,
            }
          : {
              client_id: null,
              lead_id: contact.id,
              channel: "Email",
              direction: "outbound",
              subject,
              message,
              contacted_at:
                new Date().toISOString(),
              created_by:
                userData.user.id,
            };

      communicationInsert =
        await supabase
          .from("communication_logs")
          .insert(retryPayload);
    }

    if (communicationInsert.error) {
      console.error(
        "Email sent but communication log insert failed:",
        communicationInsert.error,
      );
    }

    const emailMessageInsert =
      await supabase
        .from("email_messages")
        .insert({
          direction:
            "outbound",
          mailbox:
            "info@swayphics.co.za",
          source_key:
            "resend:" +
            (
              emailId ||
              crypto.randomUUID()
            ),
          imap_uid:
            null,
          external_id:
            emailId,
          message_id:
            resendMessageId,
          in_reply_to:
            inReplyTo,
          references_header:
            referencesHeader,
          thread_id:
            threadId ||
            (
              "resend:" +
              (
                resendMessageId ||
                emailId ||
                crypto.randomUUID()
              )
            ),
          from_name:
            "Swayphics",
          from_email:
            "info@swayphics.co.za",
          to_email:
            recipientEmail,
          subject:
            subject || null,
          text_body:
            message,
          html_body:
            null,
          received_at:
            new Date().toISOString(),
          is_read:
            true,
          client_id:
            canLogContact &&
            resolvedContactType === "client"
              ? contact.id
              : null,
          lead_id:
            canLogContact &&
            resolvedContactType === "lead"
              ? contact.id
              : null,
          created_by:
            userData.user.id
        });

    if (emailMessageInsert.error) {
      console.error(
        "Email sent but email message insert failed:",
        emailMessageInsert.error,
      );
    }

    await supabase
      .from("activity_log")
      .insert({
        actor_id:
          userData.user.id,
        action:
          "Sent email to " +
          String(
            contact.business_name ||
            recipientEmail,
          ).trim(),
        entity_type:
          canLogContact
            ? (
                resolvedContactType === "client"
                  ? "clients"
                  : "leads"
              )
            : "email",
        entity_id:
          canLogContact
            ? contact.id
            : null,
      });

    return Response.json(
      {
        success: true,
        email_id: emailId,
        message_id:
          resendMessageId,
        email_message_logged:
          !emailMessageInsert.error,
        recipient:
          recipientEmail,
        communication_logged:
          !communicationInsert.error,
        communication_log_error:
          communicationInsert.error
            ? String(
                communicationInsert.error.message ||
                communicationInsert.error.details ||
                "Communication log insert failed."
              )
            : null,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error(
      "Swayphics email function error:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to send the email.",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
