import {
  CLOUDFLARE_MODEL,
  isCloudflareEligibleWritingRequest,
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
