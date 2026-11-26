"use strict";

const assert = require("node:assert/strict");

(async () => {
    const provider = await import("../supabase/functions/_shared/business-assessment-evidence.mjs");

    assert.equal(
        provider.normalisePublicUrl("https://www.example.co.za/path#section"),
        "https://www.example.co.za/path"
    );
    assert.equal(provider.normalisePublicUrl(""), null);
    assert.equal(
        provider.normalisePublicUrl("https://example.co.za/?utm_source=campaign&token=secret&email=a%40b.co.za"),
        "https://example.co.za/"
    );
    assert.equal(
        provider.normalisePublicUrl("https://www.google.com/maps?cid=12345&query=Example+Studio&authuser=2"),
        "https://www.google.com/maps?cid=12345&query=Example+Studio"
    );
    assert.throws(() => provider.normalisePublicUrl("javascript:alert(1)"), /public HTTP or HTTPS/);
    assert.throws(() => provider.normalisePublicUrl("http://127.0.0.1/admin"), /public HTTP or HTTPS/);
    assert.throws(() => provider.normalisePublicUrl("https://user:pass@example.com"), /public HTTP or HTTPS/);
    assert.equal(provider.detectPlatform("https://www.instagram.com/example/"), "instagram");
    assert.equal(provider.detectPlatform("https://www.google.com/maps/place/example"), null);
    assert.equal(
        provider.normalisePublicUrl("https://maps.google.co.za/maps?query=Azande&authuser=2"),
        "https://maps.google.co.za/maps?query=Azande"
    );

    const confirmed = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty | Pretoria",
        text: "Welcome to Azande Hair & Beauty in Pretoria."
    });
    assert.equal(confirmed.status, "confirmed");
    assert.ok(confirmed.basis.length >= 2);

    const officialWebsite = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty | Pretoria",
        text: "Welcome to Azande Hair & Beauty in Pretoria.",
        sourceType: "website",
        sourceUrl: "https://azandehair.co.za/"
    });
    assert.equal(officialWebsite.status, "confirmed");

    const googleProfile = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty",
        text: "Azande Hair & Beauty, Pretoria.",
        sourceType: "google_business_profile",
        sourceUrl: "https://maps.google.co.za/maps/place/Azande"
    });
    assert.equal(googleProfile.status, "confirmed");

    const googleSearchPage = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty",
        text: "Azande Hair & Beauty, Pretoria.",
        sourceType: "google_business_profile",
        sourceUrl: "https://www.google.co.za/search?q=Azande"
    });
    assert.equal(googleSearchPage.status, "ambiguous");

    const directoryListing = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty",
        text: "Azande Hair & Beauty, Pretoria. Contact details and opening hours.",
        sourceType: "website",
        sourceUrl: "https://www.yellowpages.co.za/azande-hair-beauty"
    });
    assert.equal(directoryListing.status, "ambiguous");
    assert.ok(directoryListing.basis.some((item) => /directory or third-party listing/i.test(item)));

    const officialSocial = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty | Pretoria",
        text: "Welcome to Azande Hair & Beauty in Pretoria.",
        sourceType: "social_profile",
        sourceUrl: "https://www.instagram.com/azandehair/"
    });
    assert.equal(officialSocial.status, "confirmed");

    const unrelatedSocial = provider.matchBusinessIdentity({
        businessName: "Azande Hair & Beauty",
        location: "Pretoria",
        title: "Azande Hair & Beauty",
        text: "Azande Hair & Beauty, Pretoria.",
        sourceType: "social_profile",
        sourceUrl: "https://www.instagram.com/randomdailyquotes/"
    });
    assert.equal(unrelatedSocial.status, "ambiguous");

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
    assert.equal(provider.mapTinyFishFetchError("login_required"), "blocked");
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
