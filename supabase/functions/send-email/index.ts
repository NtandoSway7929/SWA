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
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function brandedEmailHtml(
  recipientName: string,
  businessName: string,
  message: string,
) {
  const greetingName =
    recipientName ||
    businessName ||
    "there";

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
          Hi ${escapeHtml(greetingName)},
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

    let table =
      contactType === "lead"
        ? "leads"
        : "clients";

    const columns =
      "id,business_name,contact_name,email";

    let contact: {
      id: string;
      business_name?: string | null;
      contact_name?: string | null;
      email?: string | null;
    } | null = null;

    let contactError: unknown = null;

    if (contactId) {
      const byId =
        await supabase
          .from(table)
          .select(columns)
          .eq("id", contactId)
          .maybeSingle();

      contact = byId.data || null;
      contactError = byId.error || null;
    }

    if (!contact && requestedRecipientEmail) {
      const byEmail =
        await supabase
          .from(table)
          .select(columns)
          .ilike("email", requestedRecipientEmail)
          .maybeSingle();

      contact = byEmail.data || null;
      contactError = byEmail.error || contactError;
    }

    if (!contact) {
      console.error(
        "Recipient lookup failed:",
        {
          selected_table: table,
          contact_id: contactId,
          recipient_email: requestedRecipientEmail,
          error: contactError,
        },
      );

      throw new Error(
        "The selected recipient could not be found in the Swayphics contacts. Refresh the dashboard and select the recipient again.",
      );
    }

    const recipientEmail =
      String(contact.email || "").trim().toLowerCase();

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
      recipientEmail !==
        requestedRecipientEmail
    ) {
      throw new Error(
        "The selected recipient email does not match the saved contact. Refresh the dashboard and select the recipient again.",
      );
    }

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
            html:
              brandedEmailHtml(
                String(contact.contact_name || "").trim(),
                String(contact.business_name || "").trim(),
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

    const resolvedContactType =
      table === "clients"
        ? "client"
        : "lead";

    let communicationInsert =
      await supabase
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
        });

    // Retry once using the normalized contact type. This protects against
    // stale client/lead selections after a contact has been converted.
    if (communicationInsert.error) {
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
          table,
        entity_id:
          contact.id,
      });

    return Response.json(
      {
        success: true,
        email_id: emailId,
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
