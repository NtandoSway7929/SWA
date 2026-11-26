"use strict";

const assert = require("node:assert/strict");

(async () => {
    const provider = await import("../supabase/functions/inspect-business-assessment/provider.mjs");

    assert.equal(
        provider.normalisePublicUrl("https://www.example.co.za/path#section"),
        "https://www.example.co.za/path"
    );
    assert.equal(provider.normalisePublicUrl(""), null);
    assert.throws(() => provider.normalisePublicUrl("javascript:alert(1)"), /public HTTP or HTTPS/);
    assert.throws(() => provider.normalisePublicUrl("http://127.0.0.1/admin"), /public HTTP or HTTPS/);
    assert.throws(() => provider.normalisePublicUrl("https://user:pass@example.com"), /public HTTP or HTTPS/);
    assert.equal(provider.detectPlatform("https://www.instagram.com/example/"), "instagram");
    assert.equal(provider.detectPlatform("https://www.google.com/maps/place/example"), null);

    const confirmed = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty | Pretoria",
        text: "Welcome to Azande Hair & Beauty in Pretoria."
    });
    assert.equal(confirmed.status, "confirmed");
    assert.ok(confirmed.basis.length >= 2);

    const ambiguous = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty",
        text: "Our services and contact details."
    });
    assert.equal(ambiguous.status, "ambiguous");

    const rejected = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Unrelated Coffee Shop",
        text: "A coffee shop in Cape Town."
    });
    assert.equal(rejected.status, "rejected");

    assert.equal(provider.mapTinyFishFetchError("bot_blocked"), "blocked");
    assert.equal(provider.mapTinyFishFetchError("timeout"), "timeout");
    assert.equal(provider.mapTinyFishFetchError("page_not_found"), "unreachable");
    assert.equal(provider.mapTinyFishFetchError("unexpected_error"), "fetch_error");

    const observations = provider.buildPageObservations({
        title: "Example business",
        description: "Contact the team.",
        language: "en",
        links: [
            "https://example.com/contact?email=customer%40example.com&token=private-token",
            "https://example.com/book-now?session=private-session",
            "https://example.com/about"
        ],
        text: "Contact us at team@example.com or +27 82 123 4567."
    });
    assert.equal(observations.contact_links.length, 1);
    assert.equal(observations.booking_links.length, 1);
    assert.equal(observations.contact_links[0], "https://example.com/contact");
    assert.equal(observations.booking_links[0], "https://example.com/book-now");
    assert.doesNotMatch(JSON.stringify(observations), /customer%40example\.com|private-token|private-session/);
    assert.doesNotMatch(observations.public_excerpt, /team@example.com|\+27 82/);
    assert.ok(observations.public_excerpt.includes("[email]"));
    assert.ok(observations.public_excerpt.includes("[phone]"));

    console.log("Business Opportunity Finder inspection provider tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
