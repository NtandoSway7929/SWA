import {
  CLOUDFLARE_MODEL,
  INNERME_CHAT_ROUTINE_MODEL,
  INNERME_CHAT_REASONING_MODEL,
  isCloudflareEligibleWritingRequest,
  selectInnerMeChatRoute,
  tryCloudflareFallbackForGeminiQuota,
} from "./innerme-provider-routing.mjs";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const noHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

Deno.test("InnerMe low-cost provider routing policy", async (t) => {
  await t.step("pins the approved Cloudflare model", () => {
    assertEqual(
      CLOUDFLARE_MODEL,
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      "Cloudflare model",
    );
  });

  await t.step("routes standalone caption requests as eligible", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a social media caption for Swayphics promoting logo design services.",
        noHistory,
        null,
      ),
      true,
      "Standalone caption eligibility",
    );
  });

  await t.step("recognises common short-form writing instructions case-insensitively", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest("Please POLISH this sentence.", noHistory, null),
      true,
      "Polish instruction eligibility",
    );
  });

  await t.step("keeps requests with conversation history off the Cloudflare route", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a social media caption for Swayphics.",
        [{ role: "user", content: "Remember the earlier plan." }],
        null,
      ),
      false,
      "Conversation-history exclusion",
    );
  });

  await t.step("keeps focused-record requests off the Cloudflare route", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a social media caption.",
        noHistory,
        { id: "synthetic-record" },
      ),
      false,
      "Focused-record exclusion",
    );
  });

  await t.step("rejects oversized prompts", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a caption. " + "x".repeat(1200),
        noHistory,
        null,
      ),
      false,
      "Oversized-prompt exclusion",
    );
  });

  await t.step("rejects prompts containing email addresses or phone numbers", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a caption and include hello@example.com.",
        noHistory,
        null,
      ),
      false,
      "Email-address exclusion",
    );
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "Write a caption and include 082 123 4567.",
        noHistory,
        null,
      ),
      false,
      "Phone-number exclusion",
    );
  });

  await t.step("rejects financial, client, proposal, and strategic context", () => {
    for (const prompt of [
      "Write a caption for this client proposal.",
      "Write a caption about invoice payment.",
      "Write a caption based on the workspace forecast.",
      "Write a tagline for this confidential strategy.",
    ]) {
      assertEqual(
        isCloudflareEligibleWritingRequest(prompt, noHistory, null),
        false,
        `Sensitive-context exclusion for: ${prompt}`,
      );
    }
  });


  await t.step("routes a short stateless routine question to Flash-Lite first", () => {
    const route = selectInnerMeChatRoute("What does a conversion rate mean?", noHistory, null);
    assertEqual(route.tier, "routine", "Routine tier");
    assertEqual(route.reason, "routine_request", "Routine route reason");
    assertEqual(route.primaryModel, INNERME_CHAT_ROUTINE_MODEL, "Routine primary model");
    assertEqual(route.fallbackModel, INNERME_CHAT_REASONING_MODEL, "Routine fallback model");
  });

  await t.step("keeps stateful follow-up questions on the reasoning model", () => {
    const route = selectInnerMeChatRoute(
      "What changed since earlier?",
      [{ role: "user", content: "Earlier question" }],
      null,
    );
    assertEqual(route.tier, "reasoning", "Stateful tier");
    assertEqual(route.reason, "conversation_history", "Stateful route reason");
    assertEqual(route.primaryModel, INNERME_CHAT_REASONING_MODEL, "Stateful primary model");
    assertEqual(route.fallbackModel, INNERME_CHAT_ROUTINE_MODEL, "Stateful fallback model");
  });

  await t.step("keeps focused-record and long requests on the reasoning model", () => {
    const focusedRoute = selectInnerMeChatRoute("Summarise this record.", noHistory, { id: "synthetic" });
    assertEqual(focusedRoute.primaryModel, INNERME_CHAT_REASONING_MODEL, "Focused record primary model");
    assertEqual(focusedRoute.reason, "focused_record", "Focused record route reason");

    const longRoute = selectInnerMeChatRoute("Explain this carefully. " + "detail ".repeat(110), noHistory, null);
    assertEqual(longRoute.primaryModel, INNERME_CHAT_REASONING_MODEL, "Long request primary model");
    assertEqual(longRoute.reason, "long_request", "Long request route reason");
  });

  await t.step("routes high-reasoning and high-consequence requests to the reasoning model", () => {
    for (const prompt of [
      "Compare the two strategies and explain the trade-off.",
      "Audit the security and permissions for this action.",
      "Forecast revenue and verify the assumptions.",
      "How much cash is outstanding?",
      "Send an email to the lead.",
      "Create a task for this follow-up.",
      "What should I prioritise to improve conversion?",
      "Explain the Phase 30 action safety gate.",
    ]) {
      const route = selectInnerMeChatRoute(prompt, noHistory, null);
      assertEqual(
        route.primaryModel,
        INNERME_CHAT_REASONING_MODEL,
        "Reasoning model selection for: " + prompt,
      );
    }
  });

  await t.step("does not route generic questions to the copywriting provider", () => {
    assertEqual(
      isCloudflareEligibleWritingRequest(
        "What should Swayphics prioritise to win more clients?",
        noHistory,
        null,
      ),
      false,
      "Generic-assistant exclusion",
    );
  });
});


Deno.test("Gemini daily-quota fallback decision is bounded and mockable", async (t) => {
  await t.step("tries the existing Cloudflare fallback when Gemini daily quota is reached", async () => {
    const fallbackResponse = { status: 200, provider: "cloudflare" };
    const calls: string[] = [];
    const response = await tryCloudflareFallbackForGeminiQuota(
      "daily_quota_reached",
      async (reason: string) => {
        calls.push(reason);
        return fallbackResponse;
      },
    );

    assertEqual(response, fallbackResponse, "Successful fallback response");
    assertEqual(calls.length, 1, "Fallback invocation count");
    assertEqual(calls[0], "gemini_daily_quota_reached", "Fallback reason");
  });

  await t.step("does not call Cloudflare for other guard failures", async () => {
    for (const guardReason of [
      "quota_guard_unavailable",
      "quota_guard_invalid_response",
      "model_not_approved",
      "request_too_large",
      "daily_request_limit",
      "unknown_guard_failure",
    ]) {
      let calls = 0;
      const response = await tryCloudflareFallbackForGeminiQuota(
        guardReason,
        async () => {
          calls += 1;
          return { status: 200 };
        },
      );
      assertEqual(response, null, "Denied fallback result for " + guardReason);
      assertEqual(calls, 0, "Fallback invocation count for " + guardReason);
    }
  });

  await t.step("preserves the blocked result when Cloudflare cannot recover", async () => {
    let calls = 0;
    const response = await tryCloudflareFallbackForGeminiQuota(
      "daily_quota_reached",
      async (reason: string) => {
        calls += 1;
        assertEqual(reason, "gemini_daily_quota_reached", "Cloudflare failure reason");
        return null;
      },
    );
    assertEqual(response, null, "Failed Cloudflare fallback result");
    assertEqual(calls, 1, "Failed fallback should be attempted once");
  });
});
