import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReviewRequest {
  project_id?: string;
  force?: boolean;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reviewEmailHtml(
  client: any,
  project: any,
  reviewUrl: string,
) {
  const clientName =
    String(client.business_name || "").trim() ||
    "Business";

  return `
<!doctype html>
<html>
<body style="margin:0;background:#F4F7FC;font-family:Arial,Helvetica,sans-serif;color:#081533;">
  <div style="max-width:680px;margin:0 auto;padding:32px 18px;">
    <div style="background:#FFFFFF;border:1px solid #E0E6F0;border-radius:20px;overflow:hidden;">
      <div style="padding:28px 30px;background:linear-gradient(135deg,#002096,#0152F4);color:#FFFFFF;">
        <div style="font-size:24px;font-weight:800;letter-spacing:-0.03em;">SWAYPHICS</div>
        <div style="margin-top:6px;font-size:10px;letter-spacing:0.16em;font-weight:700;">YOUR EXPERIENCE MATTERS</div>
      </div>

      <div style="padding:30px;">
        <div style="font-size:12px;color:#56627A;">Project completed</div>

        <h1 style="margin:8px 0 18px;font-size:28px;line-height:1.2;color:#081533;">
          Thank you for choosing Swayphics.
        </h1>

        <p style="font-size:15px;line-height:1.8;color:#56627A;">
          Hi ${escapeHtml(clientName)},
        </p>

        <p style="font-size:15px;line-height:1.8;color:#56627A;">
          We have completed <strong style="color:#081533;">${escapeHtml(project.name)}</strong>
          and we would genuinely value hearing about your experience working with Swayphics.
        </p>

        <p style="font-size:15px;line-height:1.8;color:#56627A;">
          Tell us what you thought about the process, the communication and the final result.
          Your story can also help future clients understand what it is like to work with us.
        </p>

        <div style="margin:28px 0;">
          <a
            href="${escapeHtml(reviewUrl)}"
            style="display:inline-block;padding:13px 20px;border-radius:11px;background:#002096;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:800;"
          >
            Share your story →
          </a>
        </div>

        <p style="font-size:13px;line-height:1.7;color:#7A899D;">
          Thank you for trusting Swayphics with your business.
        </p>
      </div>

      <div style="padding:18px 30px;background:#F7FAFF;font-size:11px;line-height:1.75;color:#7A899D;">
        <strong style="color:#081533;">Swayphics</strong> · Empowering Through Design<br>
        <a href="https://swayphics.co.za/privacy-policy/" style="color:#56627A;text-decoration:underline;">Privacy Policy</a>
        <span style="padding:0 6px;color:#B4BFCE;">·</span>
        <a href="https://swayphics.co.za/terms-and-conditions/" style="color:#56627A;text-decoration:underline;">Terms &amp; Conditions</a><br>
        <span style="color:#8A97A8;">© 2026 Swayphics. All rights reserved.</span><br>
        <span style="color:#8A97A8;">This email and any attachments are intended only for the addressed recipient. If received in error, please notify the sender and delete it.</span>
      </div>
    </div>
  </div>
</body>
</html>
`;
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

    const body: ReviewRequest =
      await req.json();

    const projectId =
      body.project_id?.trim();

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required." },
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

    const {
      data: project,
      error: projectError,
    } =
      await supabase
        .from("client_projects")
        .select("*")
        .eq("id", projectId)
        .single();

    if (projectError || !project) {
      throw new Error(
        "Completed project could not be found.",
      );
    }

    if (project.status !== "completed") {
      throw new Error(
        "The client review email can only be sent after the project is completed.",
      );
    }

    if (!project.client_id) {
      throw new Error(
        "This project is not linked to a client.",
      );
    }

    const {
      data: client,
      error: clientError,
    } =
      await supabase
        .from("clients")
        .select(
          "id,business_name,contact_name,email",
        )
        .eq("id", project.client_id)
        .single();

    if (clientError || !client) {
      throw new Error(
        "The client linked to this project could not be found.",
      );
    }

    if (!String(client.email || "").trim()) {
      await supabase
        .from("client_projects")
        .update({
          review_email_status: "failed",
        })
        .eq("id", projectId);

      return Response.json(
        {
          error:
            "The client does not have an email address.",
        },
        {
          status: 422,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: settings,
      error: settingsError,
    } =
      await supabase
        .from("workflow_settings")
        .select("review_link")
        .eq("id", 1)
        .single();

    if (settingsError) {
      throw new Error(
        "Workflow settings could not be loaded.",
      );
    }

    const reviewUrl =
      settings?.review_link ||
      "https://swayphics.co.za/testimonial/";

    const {
      data: existingRequest,
      error: requestLookupError,
    } =
      await supabase
        .from("client_review_requests")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();

    if (requestLookupError) {
      throw new Error(
        "Review request could not be checked.",
      );
    }

    if (
      existingRequest?.status === "sent" &&
      body.force !== true
    ) {
      return Response.json(
        {
          success: true,
          already_sent: true,
          project_id: projectId,
          email_id: existingRequest.email_id,
        },
        {
          status: 200,
          headers: corsHeaders,
        },
      );
    }

    if (!resendApiKey) {
      await supabase
        .from("client_projects")
        .update({
          review_email_status: "failed",
        })
        .eq("id", projectId);

      throw new Error(
        "Email sending is not configured yet. Add RESEND_API_KEY to your Edge Function secrets.",
      );
    }

    await supabase
      .from("client_projects")
      .update({
        review_email_status: "queued",
      })
      .eq("id", projectId);

    const {
      data: request,
      error: requestUpsertError,
    } =
      await supabase
        .from("client_review_requests")
        .upsert(
          {
            project_id: projectId,
            client_id: project.client_id,
            email: client.email,
            review_url: reviewUrl,
            status: "queued",
            error_message: null,
          },
          {
            onConflict: "project_id",
          },
        )
        .select("*")
        .single();

    if (requestUpsertError || !request) {
      throw new Error(
        "The client review request could not be queued.",
      );
    }

    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") ||
      "Swayphics <info@swayphics.co.za>";

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
            to: [client.email],
            subject:
              "How was your experience with Swayphics?",
            html:
              reviewEmailHtml(
                client,
                project,
                reviewUrl,
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
      const message =
        result?.message ||
        result?.error?.message ||
        responseText ||
        "Email provider rejected the request.";

      await supabase
        .from("client_review_requests")
        .update({
          status: "failed",
          error_message:
            String(message).slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);

      await supabase
        .from("client_projects")
        .update({
          review_email_status: "failed",
        })
        .eq("id", projectId);

      throw new Error(
        String(message),
      );
    }

    const emailId =
      result?.id || null;

    await supabase
      .from("client_review_requests")
      .update({
        status: "sent",
        email_id: emailId,
        requested_at:
          new Date().toISOString(),
        error_message: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", request.id);

    await supabase
      .from("client_projects")
      .update({
        review_requested_at:
          new Date().toISOString(),
        review_email_status: "sent",
      })
      .eq("id", projectId);

    return Response.json(
      {
        success: true,
        project_id: projectId,
        email_id: emailId,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error(
      "Client review request error:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to send client review email.",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
