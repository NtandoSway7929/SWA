import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  contact_type?: "client" | "lead";
  contact_id?: string;
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
      <div style="padding:25px 30px;background:linear-gradient(135deg,#002096 0%,#0031C5 50%,#0152F4 100%);">
        <img
          src="https://swayphics.co.za/swayphics-logo.png"
          alt="Swayphics"
          width="145"
          style="display:block;width:145px;height:auto;"
        />
        <div style="margin-top:10px;color:rgba(255,255,255,.76);font-size:10px;line-height:1.4;font-weight:700;letter-spacing:.16em;">
          EMPOWERING THROUGH DESIGN
        </div>
      </div>

      <div style="padding:34px 30px 26px;">
        <div style="margin-bottom:10px;color:#0152F4;font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;">
          Swayphics
        </div>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#56627A;">
          Hi ${escapeHtml(greetingName)},
        </p>

        ${emailParagraphs(message)}

        <p style="margin:24px 0 0;font-size:15px;line-height:1.8;color:#56627A;">
          Kind Regards,<br>
          <strong style="color:#081533;">Swayphics</strong>
        </p>
      </div>

      <div style="padding:18px 30px;background:#F7FAFF;border-top:1px solid #E7ECF4;color:#7A899D;font-size:11px;line-height:1.7;">
        <strong style="color:#081533;">Swayphics</strong> · Empowering Through Design<br>
        info@swayphics.co.za · swayphics.co.za
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

    const contactId =
      String(body.contact_id || "").trim();

    const message =
      String(body.message || "").trim();

    if (!contactType || !contactId) {
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

    const table =
      contactType === "lead"
        ? "leads"
        : "clients";

    const columns =
      contactType === "lead"
        ? "id,business_name,contact_name,email"
        : "id,business_name,contact_name,email";

    const {
      data: contact,
      error: contactError,
    } =
      await supabase
        .from(table)
        .select(columns)
        .eq("id", contactId)
        .single();

    if (contactError || !contact) {
      throw new Error(
        "The selected recipient could not be found.",
      );
    }

    const recipientEmail =
      String(contact.email || "").trim();

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

    const communicationInsert =
      await supabase
        .from("communication_logs")
        .insert({
          client_id:
            contactType === "client"
              ? contact.id
              : null,
          lead_id:
            contactType === "lead"
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

    if (communicationInsert.error) {
      console.warn(
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
