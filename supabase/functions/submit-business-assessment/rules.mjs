import {
    CONSENT_VERSION,
    detectPlatform,
    isGoogleMapsUrl as isGoogleBusinessUrl,
    normalisePublicUrl
} from "../_shared/business-assessment-evidence.mjs";

export const ASSESSMENT_VERSION = "bof-2026-11-v1";
export const CONTACT_NOTICE_VERSION = "bof-contact-v1";

const INDUSTRIES = {
    beauty_personal_care: "Beauty & personal care",
    food_beverage: "Food & beverage",
    retail_ecommerce: "Retail & e-commerce",
    professional_services: "Professional services",
    trades_construction: "Trades & construction",
    education_training: "Education & training",
    events_entertainment: "Events & entertainment",
    other: "Another type of business"
};

const DISCOVERY = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    google_business: "Google Business Profile",
    website: "Business website",
    no_website: "I don't currently have a website",
    directories: "Online directories or marketplaces",
    referrals: "Referrals or word of mouth",
    walk_ins: "Walk-ins or a physical location",
    no_online_presence: "I don't currently have an online presence"
};

const CONTACT_METHODS = {
    whatsapp: "WhatsApp",
    phone: "Phone calls",
    social_dm: "Instagram or Facebook messages",
    website_form: "Website enquiry form",
    booking_tool: "Online booking or appointment tool",
    online_checkout: "Online store or checkout",
    email: "Email",
    marketplace: "Marketplace or delivery platform",
    in_person: "In person or walk-in",
    other: "Another way"
};

const FRICTION = {
    missed_followups: "Keeping up with enquiries and follow-ups",
    booking_admin: "Managing bookings, appointments or orders",
    repeated_questions: "Answering the same customer questions",
    hard_to_find: "Getting discovered by new customers",
    offer_clarity: "Explaining services, products or pricing clearly",
    trust: "Building confidence before a customer commits",
    repeat_business: "Encouraging customers to return",
    not_sure: "I'm not sure yet"
};

const PRIORITIES = {
    visibility: "Help more of the right people find the business",
    enquiries: "Generate more relevant enquiries",
    booking: "Make booking or ordering easier",
    responses: "Handle customer messages more consistently",
    credibility: "Present the business more clearly and professionally",
    retention: "Improve the experience for existing customers",
    exploring: "I'm exploring and want a clearer picture"
};

const SERVICES = {
    website: {
        title: "Website Design & Development",
        href: "../services/website-design/",
        description: "Bring key business information, services and next steps into one clear online destination."
    },
    booking: {
        title: "Booking / Appointment Systems",
        href: "../services/booking-systems/",
        description: "Give customers a clearer route to request or make an appointment."
    },
    replies: {
        title: "AI Customer Reply Setup",
        href: "../services/ai-customer-replies/",
        description: "Configure an assisted response workflow around common enquiries and clear human handover."
    },
    google: {
        title: "Google Business Profile",
        href: "../services/google-business-profile/",
        description: "Set up or improve the business information customers see when they search locally."
    },
    reviews: {
        title: "Review Collection System",
        href: "../services/review-collection/",
        description: "Make it easier to invite customers to share feedback and reviews."
    }
};

const EXPECTED_QUESTIONS = ["industry", "discovery", "contactMethods", "friction", "priority"];
const ONLINE_DISCOVERY = [
    "instagram", "facebook", "tiktok", "google_business",
    "website", "no_website", "directories"
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, fieldName, maxLength) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error(`${fieldName} must be text.`);
    const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length > maxLength) throw new Error(`${fieldName} is too long.`);
    return cleaned;
}



function normalizePublicPresence(value, businessName, location) {
    if (!isObject(value) || value.inspection_consent !== true) {
        return { inspection_consent: false };
    }
    if (value.inspection_consent_version !== CONSENT_VERSION) {
        throw new Error("The public-presence inspection consent version is not supported.");
    }
    if (!businessName || !location) {
        throw new Error("Enter the business name and city or area before agreeing to a public-presence inspection.");
    }

    const optionalUrl = (raw, label) => {
        const cleaned = cleanText(raw, label, 2048);
        if (!cleaned) return null;
        return normalisePublicUrl(cleaned);
    };

    const websiteUrl = optionalUrl(value.website_url, "Website URL");
    if (websiteUrl && (detectPlatform(websiteUrl) || isGoogleBusinessUrl(websiteUrl))) {
        throw new Error("Enter a business website URL in the website field.");
    }

    const googleUrl = optionalUrl(value.google_business_profile_url, "Google Business Profile URL");
    if (googleUrl && !isGoogleBusinessUrl(googleUrl)) {
        throw new Error("Enter a Google Maps or Google Business Profile link.");
    }

    const rawSocials = value.social_profile_urls === undefined ? [] : value.social_profile_urls;
    if (!Array.isArray(rawSocials) || rawSocials.length > 4) {
        throw new Error("Provide no more than four public social profile links.");
    }
    const socialProfileUrls = [];
    const seen = new Set();
    for (const entry of rawSocials) {
        if (!isObject(entry)) throw new Error("A social profile entry is invalid.");
        const url = optionalUrl(entry.url, "Social profile URL");
        if (!url) continue;
        const platform = detectPlatform(url);
        if (!platform || (entry.platform && entry.platform !== platform)) {
            throw new Error("Each social profile URL must match Instagram, Facebook, TikTok or LinkedIn.");
        }
        if (!seen.has(url)) {
            seen.add(url);
            socialProfileUrls.push({ platform, url });
        }
    }

    return {
        inspection_consent: true,
        inspection_consent_version: CONSENT_VERSION,
        consented_at: new Date().toISOString(),
        website_url: websiteUrl,
        google_business_profile_url: googleUrl,
        social_profile_urls: socialProfileUrls
    };
}

function validateChoice(value, allowed, fieldName) {
    if (typeof value !== "string" || !Object.hasOwn(allowed, value)) {
        throw new Error(`Choose a valid ${fieldName}.`);
    }
    return value;
}

function validateChoiceArray(value, allowed, fieldName, maxItems) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
        throw new Error(`Choose between 1 and ${maxItems} ${fieldName}.`);
    }
    const unique = [...new Set(value)];
    if (unique.length !== value.length || unique.some((item) => typeof item !== "string" || !Object.hasOwn(allowed, item))) {
        throw new Error(`One or more ${fieldName} are invalid.`);
    }
    return unique;
}

export function normalizeAssessmentPayload(payload) {
    if (!isObject(payload)) throw new Error("Assessment data is missing.");
    if (payload.assessment_version !== ASSESSMENT_VERSION) throw new Error("This assessment version is not supported.");
    if (typeof payload.submission_key !== "string" || !UUID_PATTERN.test(payload.submission_key)) {
        throw new Error("A valid submission reference is required.");
    }
    if (!isObject(payload.business_profile)) throw new Error("Business profile must be an object.");
    if (!Array.isArray(payload.responses) || payload.responses.length !== EXPECTED_QUESTIONS.length) {
        throw new Error("The completed assessment responses are incomplete.");
    }

    const responseMap = new Map();
    for (const entry of payload.responses) {
        if (!isObject(entry) || typeof entry.question_id !== "string" || responseMap.has(entry.question_id)) {
            throw new Error("Assessment question responses are invalid.");
        }
        if (!EXPECTED_QUESTIONS.includes(entry.question_id)) throw new Error("An unsupported assessment question was supplied.");
        responseMap.set(entry.question_id, entry.answer);
    }

    if (EXPECTED_QUESTIONS.some((key) => !responseMap.has(key))) {
        throw new Error("The completed assessment responses are incomplete.");
    }

    const answers = {
        industry: validateChoice(responseMap.get("industry"), INDUSTRIES, "industry"),
        discovery: validateChoiceArray(responseMap.get("discovery"), DISCOVERY, "discovery routes", 8),
        contactMethods: validateChoiceArray(responseMap.get("contactMethods"), CONTACT_METHODS, "contact methods", 10),
        friction: validateChoiceArray(responseMap.get("friction"), FRICTION, "challenges", 3),
        priority: validateChoice(responseMap.get("priority"), PRIORITIES, "priority")
    };

    if (answers.friction.includes("not_sure") && answers.friction.length > 1) {
        throw new Error("The unsure option must be selected on its own.");
    }
    if (answers.discovery.includes("website") && answers.discovery.includes("no_website")) {
        throw new Error("Website and no-website selections cannot be combined.");
    }
    if (answers.discovery.includes("no_online_presence") &&
        answers.discovery.some((item) => ONLINE_DISCOVERY.includes(item))) {
        throw new Error("No online presence cannot be combined with online discovery channels.");
    }

    const businessName = cleanText(payload.business_profile.business_name, "Business name", 100);
    const location = cleanText(payload.business_profile.location, "Location", 100);
    const businessProfile = {
        business_name: businessName || null,
        location: location || null,
        public_presence: normalizePublicPresence(
            payload.business_profile.public_presence,
            businessName,
            location
        )
    };
    const responses = EXPECTED_QUESTIONS.map((question_id) => ({
        question_id,
        answer: answers[question_id]
    }));

    return {
        assessmentVersion: ASSESSMENT_VERSION,
        submissionKey: payload.submission_key.toLowerCase(),
        businessProfile,
        answers,
        responses
    };
}

function has(answers, key, value) {
    return Array.isArray(answers[key]) && answers[key].includes(value);
}

function labels(allowed, values) {
    return values.map((value) => allowed[value]);
}

export function buildBusinessOpportunityReport(businessProfile, answers) {
    const findings = [];
    const add = (id, title, explanation, sourceReference, businessImplication, nextAction, services = []) => {
        findings.push({
            id,
            title,
            explanation,
            evidence_classification: "self_reported",
            source_reference: sourceReference,
            confidence_level: "limited",
            confidence_basis: "The respondent selected this challenge. No independent website, social, Google Business Profile or operational inspection has been performed.",
            business_implication: businessImplication,
            next_action: nextAction,
            recommended_service_ids: services
        });
    };

    if (has(answers, "friction", "missed_followups")) {
        add(
            "enquiry_followthrough",
            "Make every enquiry easier to follow through",
            "You indicated that messages can be missed or follow-ups are difficult to keep track of. A clearer process for assigning the next action to each enquiry may help your team respond more consistently.",
            "friction:missed_followups",
            "An enquiry may not have a clearly owned next action, making consistent follow-through harder.",
            "Map how each enquiry is received, assigned, answered and followed up before selecting a tool.",
            ["replies"]
        );
    }
    if (has(answers, "friction", "booking_admin")) {
        add(
            "booking_process",
            "Reduce friction in booking or order coordination",
            "You identified booking, appointment or order management as a challenge. Review how customers request a slot or place an order, what information you need from them, and how availability is confirmed.",
            "friction:booking_admin",
            "Customers and staff may need to exchange several messages before a booking or order is confirmed.",
            "Document the details required, availability rules and confirmation steps.",
            ["booking"]
        );
    }
    if (has(answers, "friction", "repeated_questions")) {
        add(
            "repeated_questions",
            "Make common customer information easier to access",
            "You indicated that customers often need help with recurring questions. Clear, accessible answers about services, products, pricing or the next step may reduce unnecessary back-and-forth.",
            "friction:repeated_questions",
            "Customers may need to ask for information that could be made easier to find or understand.",
            "List the most common questions and confirm which answers can be standardised.",
            ["website", "replies"]
        );
    }
    if (has(answers, "friction", "hard_to_find")) {
        add(
            "discoverability",
            "Review how new customers discover the business",
            "You identified customer discovery as a challenge. The next step is to check whether your key business information is complete and easy to find on the channels your customers use.",
            "friction:hard_to_find",
            "Potential customers may not consistently find accurate business information on the channels they use.",
            "Identify the main discovery channels and verify the accuracy and completeness of each listing.",
            ["google"]
        );
    }
    if (has(answers, "friction", "offer_clarity")) {
        add(
            "offer_clarity",
            "Explain the offer and next step more clearly",
            "You indicated that customers may need help understanding what you offer or how to proceed. Bringing the essential details together can make the decision process clearer.",
            "friction:offer_clarity",
            "Customers may need to piece together service, product, pricing or next-step details.",
            "Review the information customers need before they enquire, book or buy.",
            ["website"]
        );
    }
    if (has(answers, "friction", "trust")) {
        add(
            "customer_confidence",
            "Give customers clearer reasons to feel confident",
            "You identified customer confidence as an area to improve. Consider how consistently you present your services, business details, examples of work and genuine customer feedback.",
            "friction:trust",
            "Customers may need clearer information or credible reassurance before committing.",
            "Review business information, examples of work and the process for inviting honest customer feedback.",
            ["website", "reviews"]
        );
    }
    if (has(answers, "friction", "repeat_business")) {
        add(
            "repeat_business",
            "Review the experience after the first purchase or visit",
            "You identified repeat business as a priority. Map what happens after a customer buys or visits, including how you invite feedback and how you keep useful communication relevant. A specific solution should be scoped around your actual process.",
            "friction:repeat_business",
            "The steps after a first purchase or visit may not yet be structured around useful follow-through.",
            "Map post-purchase communication, feedback requests and appropriate reasons to reconnect."
        );
    }
    if (has(answers, "friction", "not_sure") || findings.length === 0) {
        add(
            "discovery_first",
            "Map the customer journey before choosing a solution",
            "Your answers do not yet point to one clear bottleneck. A useful first step is to map how people discover the business, ask questions, decide, buy or book, and return.",
            "friction:not_sure_or_no_specific_issue",
            "There is not enough detail to identify one specific operational bottleneck.",
            "Map the customer journey from first discovery through enquiry, purchase or booking, and repeat business."
        );
    }

    if (has(answers, "discovery", "no_website") &&
        (has(answers, "friction", "offer_clarity") ||
         has(answers, "friction", "repeated_questions") ||
         answers.priority === "credibility") &&
        !findings.some((finding) => finding.recommended_service_ids.includes("website"))) {
        add(
            "central_information",
            "Consider whether a central online home would help",
            "You indicated that the business does not currently have a website. Because you also want clearer information or credibility, a focused website may be worth exploring. This is an opportunity to assess, not an assumption that every business needs a website.",
            "discovery:no_website_and_related_priority",
            "A central place for accurate information may help customers understand the offer and next step.",
            "Confirm which information is difficult to find and whether an independent website would address that gap.",
            ["website"]
        );
    }

    const discoveryLabels = labels(DISCOVERY, answers.discovery);
    const contactLabels = labels(CONTACT_METHODS, answers.contactMethods);
    const strengths = [];
    const existingRoutes = answers.discovery
        .filter((value) => value !== "no_website" && value !== "no_online_presence");
    if (existingRoutes.length) {
        strengths.push("You identified these existing discovery routes: " + labels(DISCOVERY, existingRoutes).join(", ") + ".");
    }
    if (has(answers, "contactMethods", "whatsapp")) {
        strengths.push("WhatsApp is already one of the ways customers can reach or transact with the business.");
    }
    if (has(answers, "contactMethods", "booking_tool")) {
        strengths.push("You already use an online booking or appointment tool.");
    }
    if (has(answers, "contactMethods", "online_checkout")) {
        strengths.push("Customers have an online checkout route available.");
    }
    if (has(answers, "discovery", "no_online_presence")) {
        strengths.push("You indicated that the business does not currently have an online presence.");
    } else if (has(answers, "discovery", "no_website")) {
        strengths.push("You indicated that the business does not currently have a website. That alone does not establish that a website should be the next investment.");
    }
    if (!strengths.length) {
        strengths.push("The answers do not yet establish which customer channels are working well. Confirming the channels customers actually use would be a useful starting point.");
    }

    let websiteStatus = "Not established from your answers";
    if (has(answers, "discovery", "no_online_presence")) websiteStatus = "No online presence reported";
    else if (has(answers, "discovery", "no_website")) websiteStatus = "No website reported";
    else if (has(answers, "discovery", "website")) websiteStatus = "Website reported; not inspected";

    const serviceIds = [];
    findings.forEach((finding) => {
        finding.recommended_service_ids.forEach((id) => {
            if (!serviceIds.includes(id)) serviceIds.push(id);
        });
    });

    const recommendationText = {
        replies: "Review an assisted response workflow for common questions and clear human handover. For missed follow-ups, also agree who owns each enquiry and how the next action is tracked.",
        booking: "Map the information, availability and confirmations needed for a booking, then assess whether a structured booking or appointment system fits.",
        website: "Clarify the essential business information customers need and assess whether a focused website would make the offer and next step easier to understand.",
        google: has(answers, "discovery", "google_business")
            ? "Review the completeness and accuracy of the existing Google Business Profile before deciding what should be improved."
            : "Assess whether a Google Business Profile is appropriate for the business and, if so, establish or complete the listing with accurate information.",
        reviews: "Review how genuine customer feedback is requested and displayed. A review process should invite honest feedback, not require positive reviews."
    };

    const recommendations = serviceIds.slice(0, 4).map((serviceId) => ({
        service_id: serviceId,
        ...SERVICES[serviceId],
        recommended_action: recommendationText[serviceId]
    }));

    const industryLabel = INDUSTRIES[answers.industry];
    const priorityLabel = PRIORITIES[answers.priority];
    const businessName = businessProfile.business_name || null;

    return {
        title: businessName ? "A clearer view of " + businessName : "A clearer view of your business",
        business_name: businessName,
        location: businessProfile.location || null,
        industry: { id: answers.industry, label: industryLabel },
        priority: { id: answers.priority, label: priorityLabel },
        website_status: websiteStatus,
        discovery_channels: discoveryLabels,
        contact_methods: contactLabels,
        current_starting_point: strengths,
        findings,
        recommendations,
        disclaimer: "This summary is based on the information selected by the respondent. It is not a verified audit or a promise of business results. No independent website, social-media or Google Business Profile inspection has been performed."
    };
}
