import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ORIGINS = new Set([
  "https://swayphics.co.za",
  "https://www.swayphics.co.za",
]);

const ALLOWED_SERVICES = new Set([
  "Starter Package",
  "Launch Package",
  "Growth Package",
  "Logo Design",
  "Business Identity Kit",
  "Business Card Design",
  "Business Letterhead Design",
  "Packaging Design",
  "Apparel Design",
  "Website Design",
  "Google Business Profile",
  "Professional Email Setup",
  "Company Registration",
  "Booking System",
  "AI Customer Reply Setup",
  "Review Collection System",
  "Website Maintenance",
  "Something else",
]);

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_PER_EMAIL = 3;

function corsHeaders(origin = "") {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorResponse(
  message: string,
  status: number,
  origin: string,
) {
  return Response.json(
    { error: message },
    {
      status,
      headers: corsHeaders(origin),
    },
  );
}

Deno.serve(async (request) => {
  const origin =
    request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (request.method !== "POST") {
    return errorResponse(
      "Method not allowed.",
      405,
      origin,
    );
  }

  if (
    origin &&
    !ALLOWED_ORIGINS.has(origin)
  ) {
    return errorResponse(
      "Request origin is not allowed.",
      403,
      origin,
    );
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      "Swayphics enquiry function is missing server configuration.",
    );

    return errorResponse(
      "Enquiry service is temporarily unavailable.",
      503,
      origin,
    );
  }

  try {
    const body = await request.json();

    /* Hidden honeypot field for basic bot filtering. */
    const website = cleanText(
      body?.website,
      200,
    );

    if (website) {
      return Response.json(
        {
          ok: true,
          message:
            "Thank you. Your enquiry has been received.",
        },
        {
          status: 200,
          headers: corsHeaders(origin),
        },
      );
    }

    const name = cleanText(
      body?.name,
      80,
    );

    const email = cleanText(
      body?.email,
      120,
    ).toLowerCase();

    const service = cleanText(
      body?.service,
      100,
    );

    const message = cleanText(
      body?.message,
      1500,
    );

    if (name.length < 2) {
      return errorResponse(
        "Please enter a valid name.",
        400,
        origin,
      );
    }

    if (!validEmail(email)) {
      return errorResponse(
        "Please enter a valid email address.",
        400,
        origin,
      );
    }

    if (!service || !ALLOWED_SERVICES.has(service)) {
      return errorResponse(
        "Please select a valid service.",
        400,
        origin,
      );
    }

    if (message.length < 10) {
      return errorResponse(
        "Please provide a little more detail about the project.",
        400,
        origin,
      );
    }

    const supabase =
      createClient(
        SUPABASE_URL,
        SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        },
      );

    const windowStart =
      new Date(
        Date.now() -
          RATE_LIMIT_WINDOW_MINUTES *
          60 *
          1000,
      ).toISOString();

    const recent =
      await supabase
        .from("website_enquiries")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("email", email)
        .gte("created_at", windowStart);

    if (recent.error) {
      console.error(
        "Swayphics enquiry rate-limit lookup failed:",
        recent.error.message,
      );

      return errorResponse(
        "We couldn't submit your enquiry right now. Please try again.",
        503,
        origin,
      );
    }

    if (
      (recent.count ?? 0) >=
      RATE_LIMIT_MAX_PER_EMAIL
    ) {
      return errorResponse(
        "Too many enquiries from this email address. Please wait a few minutes and try again.",
        429,
        origin,
      );
    }

    const { error } =
      await supabase
        .from("website_enquiries")
        .insert({
          name,
          email,
          service,
          message,
        });

    if (error) {
      console.error(
        "Swayphics enquiry insert failed:",
        error.message,
      );

      return errorResponse(
        "We couldn't submit your enquiry right now. Please try again.",
        503,
        origin,
      );
    }

    return Response.json(
      {
        ok: true,
        message:
          "Thank you. Your enquiry has been received.",
      },
      {
        status: 200,
        headers: corsHeaders(origin),
      },
    );
  } catch (error) {
    console.error(
      "Swayphics enquiry function failed:",
      error?.message || error,
    );

    return errorResponse(
      "We couldn't submit your enquiry right now. Please try again.",
      500,
      origin,
    );
  }
});
