// Swayphics Social Lead Radar — Stage 1
// X API Recent Search only. No browser automation, scraping, replies, DMs,
// follows, likes, or automated CRM lead creation.
//
// Edge Function secrets required:
//   X_API_BEARER_TOKEN
//   SOCIAL_RADAR_CRON_SECRET
// Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

const X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";
const MONITOR_KEY = "x_website_intent";
const MAX_AGE_SECONDS = 300;
const MAX_PAGES_PER_RUN = 5;
const MINIMUM_INTENT_SCORE = 45;

const SEARCH_QUERY =
  '("need a website" OR "looking for a website" OR "need a web designer" OR "looking for a web designer" OR "recommend a web designer" OR "website quote" OR "website cost" OR "build my website" OR "website for my business" OR "online booking system" OR "online store") -is:retweet';

type XPost = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
};

type XUser = {
  id: string;
  location?: string;
};

type XSearchPage = {
  data?: XPost[];
  includes?: { users?: XUser[] };
  meta?: { next_token?: string; result_count?: number; newest_id?: string };
  errors?: Array<{ message?: string; type?: string }>;
};

type ClassifiedSignal = {
  intent_score: number;
  intent_tier: "high" | "medium";
  intent_type:
    | "direct_need"
    | "recommendation_request"
    | "pricing_request"
    | "website_improvement"
    | "ecommerce_or_booking";
  market_hint: "likely_south_africa" | "unconfirmed";
  match_reasons: string[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("Missing required secret: " + name);
  return value;
}

function supabaseHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };
}

async function supabaseRequest(
  baseUrl: string,
  serviceKey: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<any> {
  const headers = new Headers(supabaseHeaders(serviceKey));
  if (method === "POST") {
    headers.set("Prefer", "resolution=ignore-duplicates,return=minimal");
  }

  const response = await fetch(
    baseUrl.replace(/\/$/, "") + "/rest/v1/" + path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      "Supabase request failed (" + response.status + "): " +
        responseText.slice(0, 500),
    );
  }
  return responseText ? JSON.parse(responseText) : null;
}

function hasSouthAfricanHint(text: string, location: string): boolean {
  const clues =
    /\b(south africa|south african|rsa|johannesburg|joburg|jozi|pretoria|tshwane|gauteng|cape town|durban|ethekwini|benoni|boksburg|midrand|sandton|soweto|randburg|centurion|stellenbosch|paarl|bloemfontein|polokwane|nelspruit|mbombela|rustenburg|george|gqeberha|port elizabeth|east london|kimberley)\b/i;
  return clues.test(text) || clues.test(location);
}

function classifyIntent(text: string, location: string): ClassifiedSignal | null {
  const value = text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  let intentType: ClassifiedSignal["intent_type"] = "direct_need";

  const directNeed =
    /\b(need|looking for|seeking|want|want to hire|trying to find|searching for|in search of|recommend|recommendation for)\b[\s\S]{0,90}\b(website|web site|web designer|web developer|web development|web design|online store|e-?commerce|online booking|booking (site|website|system))\b/i;
  const reversedNeed =
    /\b(website|web site|web designer|web developer|web development|web design|online store|e-?commerce|online booking|booking (site|website|system))\b[\s\S]{0,70}\b(needed|wanted|looking for|recommend|quote|quotation|price|cost|hire|build|create|design|develop)\b/i;
  const recommendation =
    /\b(anyone|somebody|someone|anybody)\b[\s\S]{0,50}\b(recommend|recommendation|know)\b[\s\S]{0,70}\b(website|web site|web designer|web developer|web design|web development)\b/i;
  const pricing =
    /\b(how much|price|pricing|cost|quote|quotation|budget|rates?)\b[\s\S]{0,70}\b(website|web site|web design|web development|web developer|web designer|online store)\b/i;
  const improvement =
    /\b(redesign|rebuild|refresh|upgrade|fix|improve|revamp)\b[\s\S]{0,50}\b(website|web site)\b/i;
  const ecommerceBooking =
    /\b(online store|e-?commerce|online booking|booking website|booking system|appointment booking)\b/i;
  const businessContext =
    /\b(my|our|for a|for my|for our)\s+(business|salon|barbershop|barber shop|restaurant|shop|store|company|brand|practice|agency|clinic|studio|guesthouse|lodge)\b/i;

  if (directNeed.test(value) || reversedNeed.test(value)) {
    score += 60;
    reasons.push("direct_buying_language");
    intentType = "direct_need";
  }

  if (recommendation.test(value)) {
    score += 55;
    reasons.push("recommendation_request");
    intentType = "recommendation_request";
  }

  if (pricing.test(value)) {
    score += 45;
    reasons.push("pricing_request");
    if (intentType === "direct_need") intentType = "pricing_request";
  }

  if (improvement.test(value)) {
    score += 45;
    reasons.push("existing_website_improvement");
    intentType = "website_improvement";
  }

  if (ecommerceBooking.test(value)) {
    score += 12;
    reasons.push("ecommerce_or_booking_requirement");
    if (intentType === "direct_need") intentType = "ecommerce_or_booking";
  }

  if (businessContext.test(value)) {
    score += 10;
    reasons.push("business_context_present");
  }

  const likelySouthAfrica = hasSouthAfricanHint(text, location);
  if (likelySouthAfrica) {
    score += 8;
    reasons.push("south_african_market_hint");
  }

  const providerOffer =
    /\b(i|we)\s+(build|design|develop|create|make|offer|provide)\s+(websites?|web design|web development)\b|\b(web designer|web developer)\s+(available|for hire|seeking clients)\b|\b(my|our)\s+web design services\b/i;
  const educationOrEmployment =
    /\b(assignment|homework|school project|university project|student project|tutorial|coursework|looking for (a )?job|job vacancy|vacancy|internship|learn how to (build|make|create) a website)\b/i;

  if (providerOffer.test(value)) {
    score -= 70;
    reasons.push("service_provider_or_self_promotion_excluded");
  }

  if (educationOrEmployment.test(value)) {
    score -= 50;
    reasons.push("education_or_employment_context_excluded");
  }

  score = Math.max(0, Math.min(100, score));
  if (score < MINIMUM_INTENT_SCORE) return null;

  return {
    intent_score: score,
    intent_tier: score >= 70 ? "high" : "medium",
    intent_type: intentType,
    market_hint: likelySouthAfrica ? "likely_south_africa" : "unconfirmed",
    match_reasons: reasons,
  };
}

function maxSnowflake(current: string | null, candidate: string): string {
  if (!current) return candidate;
  try {
    return BigInt(candidate) > BigInt(current) ? candidate : current;
  } catch {
    return candidate;
  }
}

async function searchX(
  bearerToken: string,
  sinceId: string | null,
  now: Date,
): Promise<{ posts: XPost[]; users: Map<string, XUser>; newestId: string | null }> {
  const params = new URLSearchParams({
    query: SEARCH_QUERY,
    max_results: "100",
    "tweet.fields": "created_at,author_id,lang",
    expansions: "author_id",
    "user.fields": "location",
  });

  if (sinceId) {
    params.set("since_id", sinceId);
  } else {
    params.set(
      "start_time",
      new Date(now.getTime() - MAX_AGE_SECONDS * 1000).toISOString(),
    );
  }

  const posts: XPost[] = [];
  const users = new Map<string, XUser>();
  let newestId: string | null = sinceId;
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > MAX_PAGES_PER_RUN) {
      throw new Error(
        "Search returned more than " + MAX_PAGES_PER_RUN +
          " pages. Check query volume before increasing the page limit.",
      );
    }

    const pageParams = new URLSearchParams(params);
    if (nextToken) pageParams.set("pagination_token", nextToken);

    const response = await fetch(X_SEARCH_URL + "?" + pageParams.toString(), {
      headers: { Authorization: "Bearer " + bearerToken },
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        "X recent-search failed (" + response.status + "): " +
          responseText.slice(0, 500),
      );
    }

    const page = JSON.parse(responseText) as XSearchPage;
    if (page.errors?.length) {
      throw new Error(
        "X returned partial search errors: " +
          page.errors.map((item) => item.message || item.type || "unknown")
            .join("; "),
      );
    }

    for (const post of page.data || []) {
      posts.push(post);
      newestId = maxSnowflake(newestId, post.id);
    }

    for (const user of page.includes?.users || []) {
      users.set(user.id, user);
    }

    nextToken = page.meta?.next_token;
  } while (nextToken);

  return { posts, users, newestId };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedCronSecret = Deno.env.get("SOCIAL_RADAR_CRON_SECRET");
  if (!expectedCronSecret) {
    return jsonResponse({ error: "Radar authentication is not configured" }, 503);
  }

  const suppliedCronSecret = request.headers.get("x-radar-cron-secret") || "";
  if (suppliedCronSecret !== expectedCronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const xBearerToken = requiredEnv("X_API_BEARER_TOKEN");
    const now = new Date();

    const stateRows = await supabaseRequest(
      supabaseUrl,
      serviceKey,
      "social_radar_state?monitor_key=eq." +
        encodeURIComponent(MONITOR_KEY) + "&select=since_id&limit=1",
      "GET",
    );

    const sinceId =
      Array.isArray(stateRows) && stateRows.length > 0
        ? (stateRows[0].since_id as string | null)
        : null;

    const result = await searchX(xBearerToken, sinceId, now);
    const discoveredAt = new Date().toISOString();
    const receivedAt = new Date(discoveredAt);
    const expiry = new Date(
      receivedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const signals: Array<Record<string, unknown>> = [];
    let staleDiscarded = 0;
    let unqualifiedDiscarded = 0;

    for (const post of result.posts) {
      if (!post.created_at) {
        staleDiscarded += 1;
        continue;
      }

      const postTime = new Date(post.created_at).getTime();
      const ageMilliseconds = receivedAt.getTime() - postTime;
      const ageSeconds = Math.ceil(ageMilliseconds / 1000);

      if (
        !Number.isFinite(postTime) || ageMilliseconds < 0 ||
        ageMilliseconds > MAX_AGE_SECONDS * 1000
      ) {
        staleDiscarded += 1;
        continue;
      }

      const authorLocation = post.author_id
        ? (result.users.get(post.author_id)?.location || "")
        : "";
      const classification = classifyIntent(post.text || "", authorLocation);

      if (!classification) {
        unqualifiedDiscarded += 1;
        continue;
      }

      signals.push({
        platform: "x",
        external_post_id: post.id,
        external_post_url: "https://x.com/i/status/" + post.id,
        post_created_at: new Date(postTime).toISOString(),
        discovered_at: discoveredAt,
        age_seconds: ageSeconds,
        intent_score: classification.intent_score,
        intent_tier: classification.intent_tier,
        intent_type: classification.intent_type,
        market_hint: classification.market_hint,
        match_reasons: classification.match_reasons,
        review_status: "new",
        expires_at: expiry,
      });
    }

    if (!dryRun && signals.length > 0) {
      for (let offset = 0; offset < signals.length; offset += 100) {
        await supabaseRequest(
          supabaseUrl,
          serviceKey,
          "social_lead_signals?on_conflict=platform,external_post_id",
          "POST",
          signals.slice(offset, offset + 100),
        );
      }
    }

    if (!dryRun) {
      const stateHeaders = new Headers(supabaseHeaders(serviceKey));
      stateHeaders.set("Prefer", "resolution=merge-duplicates,return=minimal");

      const stateResponse = await fetch(
        supabaseUrl.replace(/\/$/, "") +
          "/rest/v1/social_radar_state?on_conflict=monitor_key",
        {
          method: "POST",
          headers: stateHeaders,
          body: JSON.stringify({
            monitor_key: MONITOR_KEY,
            since_id: result.newestId,
            last_success_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          }),
        },
      );

      if (!stateResponse.ok) {
        throw new Error(
          "Could not save the search checkpoint (" + stateResponse.status +
            "): " + (await stateResponse.text()).slice(0, 500),
        );
      }
    }

    return jsonResponse({
      ok: true,
      platform: "x",
      dry_run: dryRun,
      query_label: "website_buying_intent",
      posts_received: result.posts.length,
      qualified_signals: signals.length,
      high_intent_signals: signals.filter((item) =>
        item.intent_tier === "high"
      ).length,
      medium_intent_signals: signals.filter((item) =>
        item.intent_tier === "medium"
      ).length,
      stale_discarded: staleDiscarded,
      unqualified_discarded: unqualifiedDiscarded,
      max_age_seconds: MAX_AGE_SECONDS,
      candidates: dryRun
        ? signals.map((item) => ({
          post_id: item.external_post_id,
          url: item.external_post_url,
          age_seconds: item.age_seconds,
          score: item.intent_score,
          tier: item.intent_tier,
          type: item.intent_type,
          market_hint: item.market_hint,
        }))
        : undefined,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected radar error",
      checkpoint_advanced: false,
    }, 502);
  }
});
