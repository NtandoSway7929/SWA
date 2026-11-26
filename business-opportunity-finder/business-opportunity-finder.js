(() => {
    "use strict";

    const intro = document.getElementById("bof-intro");
    const assessment = document.getElementById("bof-assessment");
    const reportSection = document.getElementById("bof-report");
    const stepContent = document.getElementById("bof-step-content");
    const stepError = document.getElementById("bof-step-error");
    const backButton = document.getElementById("bof-back");
    const continueButton = document.getElementById("bof-continue");
    const progress = document.getElementById("bof-progress");
    const progressFill = document.getElementById("bof-progress-fill");
    const progressLabel = document.getElementById("bof-progress-label");
    const progressPercent = document.getElementById("bof-progress-percent");
    const reportContent = document.getElementById("bof-report-content");
    const copyButton = document.getElementById("bof-copy-report");

    if (!intro || !assessment || !reportSection || !stepContent) {
        return;
    }

    const industryOptions = [
        { value: "beauty_personal_care", label: "Beauty & personal care", description: "Salons, barbers, nail artists, spas and wellness services" },
        { value: "food_beverage", label: "Food & beverage", description: "Restaurants, caterers, bakeries and food businesses" },
        { value: "retail_ecommerce", label: "Retail & e-commerce", description: "Shops, product brands and online sellers" },
        { value: "professional_services", label: "Professional services", description: "Consultants, agencies and specialist service providers" },
        { value: "trades_construction", label: "Trades & construction", description: "Contractors, installers, maintenance and skilled trades" },
        { value: "education_training", label: "Education & training", description: "Tutors, training providers and learning businesses" },
        { value: "events_entertainment", label: "Events & entertainment", description: "Event services, venues, performers and experiences" },
        { value: "other", label: "Another type of business", description: "A business that does not fit the categories above" }
    ];

    const discoveryOptions = [
        { value: "instagram", label: "Instagram" },
        { value: "facebook", label: "Facebook" },
        { value: "tiktok", label: "TikTok" },
        { value: "google_business", label: "Google Business Profile" },
        { value: "website", label: "Business website" },
        { value: "no_website", label: "I don't currently have a website" },
        { value: "directories", label: "Online directories or marketplaces" },
        { value: "referrals", label: "Referrals or word of mouth" },
        { value: "walk_ins", label: "Walk-ins or a physical location" },
        { value: "no_online_presence", label: "I don't currently have an online presence" }
    ];

    const contactOptions = [
        { value: "whatsapp", label: "WhatsApp" },
        { value: "phone", label: "Phone calls" },
        { value: "social_dm", label: "Instagram or Facebook messages" },
        { value: "website_form", label: "Website enquiry form" },
        { value: "booking_tool", label: "Online booking or appointment tool" },
        { value: "online_checkout", label: "Online store or checkout" },
        { value: "email", label: "Email" },
        { value: "marketplace", label: "Marketplace or delivery platform" },
        { value: "in_person", label: "In person or walk-in" },
        { value: "other", label: "Another way" }
    ];

    const frictionOptions = [
        { value: "missed_followups", label: "Keeping up with enquiries and follow-ups", description: "Messages can be missed or the next step is not always clear." },
        { value: "booking_admin", label: "Managing bookings, appointments or orders", description: "Coordination takes time or customers struggle to complete the next step." },
        { value: "repeated_questions", label: "Answering the same customer questions", description: "People need help understanding details before they proceed." },
        { value: "hard_to_find", label: "Getting discovered by new customers", description: "The right people are not always finding the business." },
        { value: "offer_clarity", label: "Explaining services, products or pricing clearly", description: "Customers may need to piece information together." },
        { value: "trust", label: "Building confidence before a customer commits", description: "People need clearer information or reassurance." },
        { value: "repeat_business", label: "Encouraging customers to return", description: "The follow-through after a first purchase or visit needs attention." },
        { value: "not_sure", label: "I'm not sure yet", description: "I would like help identifying where to focus." }
    ];

    const priorityOptions = [
        { value: "visibility", label: "Help more of the right people find the business" },
        { value: "enquiries", label: "Generate more relevant enquiries" },
        { value: "booking", label: "Make booking or ordering easier" },
        { value: "responses", label: "Handle customer messages more consistently" },
        { value: "credibility", label: "Present the business more clearly and professionally" },
        { value: "retention", label: "Improve the experience for existing customers" },
        { value: "exploring", label: "I'm exploring and want a clearer picture" }
    ];

    const industryGuidance = {
        beauty_personal_care: "Think about appointments, walk-ins, service enquiries and repeat visits.",
        food_beverage: "Think about orders, reservations, delivery, walk-ins and menu questions.",
        retail_ecommerce: "Think about product questions, stock checks, in-store and online orders.",
        professional_services: "Think about enquiries, consultations, bookings and proposals.",
        trades_construction: "Think about quote requests, site visits, project enquiries and follow-ups.",
        education_training: "Think about course enquiries, registrations, lessons and payments.",
        events_entertainment: "Think about availability, packages, bookings, tickets and event enquiries.",
        other: "Think about the point where interest becomes a customer."
    };

    const serviceCatalogue = {
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

    const answers = {
        industry: "",
        businessName: "",
        location: "",
        discovery: [],
        contactMethods: [],
        friction: [],
        priority: ""
    };

    let stepIndex = 0;
    const stepCount = 5;

    const steps = [
        {
            key: "industry",
            eyebrow: "01 / BUSINESS CONTEXT",
            title: "What kind of business are we looking at?",
            description: "Choose the category that best describes the business. You can add a name and location, but both are optional.",
            mode: "single",
            required: true,
            options: industryOptions
        },
        {
            key: "discovery",
            eyebrow: "02 / CUSTOMER DISCOVERY",
            title: "Where can customers currently find your business?",
            description: "Select every route that applies. Not selecting a channel will not be treated as proof that it does not exist.",
            mode: "multiple",
            required: true,
            options: discoveryOptions,
            hint: "Choose all that apply. You can select up to 8."
        },
        {
            key: "contactMethods",
            eyebrow: "03 / CUSTOMER JOURNEY",
            title: "How do people usually buy, book or get in touch?",
            description: "",
            mode: "multiple",
            required: true,
            options: contactOptions,
            hint: "Choose all the ways customers take the next step."
        },
        {
            key: "friction",
            eyebrow: "04 / OPERATIONAL FRICTION",
            title: "Which parts of the customer journey are hardest right now?",
            description: "Choose up to three. Select “I'm not sure yet” when you would rather explore the issue first.",
            mode: "multiple",
            required: true,
            options: frictionOptions,
            hint: "Choose up to 3."
        },
        {
            key: "priority",
            eyebrow: "05 / NEXT PRIORITY",
            title: "What would you most like to improve next?",
            description: "This helps us order the opportunities around what matters most to the business.",
            mode: "single",
            required: true,
            options: priorityOptions
        }
    ];

    const escapeHtml = (value) => String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const getOptionLabel = (list, value) => {
        const option = list.find((item) => item.value === value);
        return option ? option.label : value;
    };

    const has = (key, value) => Array.isArray(answers[key]) && answers[key].includes(value);

    function renderOption(option, mode, selected) {
        const isSelected = selected.includes(option.value);
        const indicator = isSelected ? "✓" : "";
        const detail = option.description
            ? '<small>' + escapeHtml(option.description) + '</small>'
            : "";

        return '<button class="bof-option" type="button" data-mode="' + mode +
            '" data-select-option="' + escapeHtml(option.value) +
            '" aria-pressed="' + (isSelected ? "true" : "false") + '">' +
            '<span class="bof-option-indicator" aria-hidden="true">' + indicator + '</span>' +
            '<span class="bof-option-text"><strong>' + escapeHtml(option.label) + '</strong>' + detail + '</span>' +
            '</button>';
    }

    function renderStep(focusOptionValue) {
        const step = steps[stepIndex];
        const value = answers[step.key];
        const selected = Array.isArray(value) ? value : (value ? [value] : []);
        let description = step.description;

        if (step.key === "contactMethods") {
            description = industryGuidance[answers.industry] || industryGuidance.other;
        }

        let optionalFields = "";
        if (step.key === "industry") {
            optionalFields =
                '<div class="bof-optional-fields">' +
                    '<label class="bof-field-label" for="bof-business-name">Business name <span>(optional)</span></label>' +
                    '<input class="bof-text-input" id="bof-business-name" name="business_name" maxlength="100" autocomplete="organization" placeholder="e.g. Swayphics Studio" value="' + escapeHtml(answers.businessName) + '">' +
                    '<label class="bof-field-label" for="bof-location">City or area <span>(optional)</span></label>' +
                    '<input class="bof-text-input" id="bof-location" name="location" maxlength="100" autocomplete="address-level2" placeholder="e.g. Pretoria" value="' + escapeHtml(answers.location) + '">' +
                    '<small class="bof-field-help">These details are only used in this on-screen preview. They are not sent or stored.</small>' +
                '</div>';
        }

        const options = step.options.map((option) => renderOption(option, step.mode, selected)).join("");
        const groupLabel = step.key === "industry"
            ? "Business industry"
            : step.key === "discovery"
                ? "Customer discovery channels"
                : step.key === "contactMethods"
                    ? "Customer contact and transaction methods"
                    : step.key === "friction"
                        ? "Business challenges"
                        : "Business priority";

        stepContent.innerHTML =
            '<div class="bof-step-eyebrow">' + step.eyebrow + '</div>' +
            '<h3 class="bof-step-title" tabindex="-1">' + step.title + '</h3>' +
            '<p class="bof-step-description">' + escapeHtml(description) + '</p>' +
            optionalFields +
            '<div class="bof-options" role="group" aria-label="' + groupLabel + '">' + options + '</div>' +
            (step.hint ? '<p class="bof-selection-hint">' + step.hint + '</p>' : "");

        const percent = Math.round(((stepIndex + 1) / stepCount) * 100);
        progressLabel.textContent = "Question " + (stepIndex + 1) + " of " + stepCount;
        progressPercent.textContent = percent + "%";
        progressFill.style.width = percent + "%";
        progress.setAttribute("aria-valuenow", String(percent));
        backButton.hidden = stepIndex === 0;
        continueButton.innerHTML = stepIndex === stepCount - 1
            ? 'Create my summary <span aria-hidden="true">→</span>'
            : 'Continue <span aria-hidden="true">→</span>';
        stepError.hidden = true;

        const businessNameInput = document.getElementById("bof-business-name");
        const locationInput = document.getElementById("bof-location");
        if (businessNameInput) {
            businessNameInput.addEventListener("input", () => {
                answers.businessName = businessNameInput.value.slice(0, 100);
            });
        }
        if (locationInput) {
            locationInput.addEventListener("input", () => {
                answers.location = locationInput.value.slice(0, 100);
            });
        }

        const focusTarget = focusOptionValue
            ? Array.from(stepContent.querySelectorAll("[data-select-option]"))
                .find((optionButton) => optionButton.dataset.selectOption === focusOptionValue)
            : stepContent.querySelector(".bof-step-title");

        if (focusTarget && typeof focusTarget.focus === "function") {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function toggleOption(value, mode) {
        const key = steps[stepIndex].key;

        if (mode === "single") {
            answers[key] = value;
        } else {
            let selected = [...answers[key]];
            const exclusiveValues = key === "discovery"
                ? ["no_online_presence"]
                : key === "friction"
                    ? ["not_sure"]
                    : [];

            if (selected.includes(value)) {
                selected = selected.filter((item) => item !== value);
            } else {
                if (exclusiveValues.includes(value)) {
                    selected = selected.filter((item) => !exclusiveValues.includes(item));
                    selected = selected.filter((item) => {
                        return key !== "discovery" || ![
                            "instagram", "facebook", "tiktok", "google_business",
                            "website", "no_website", "directories"
                        ].includes(item);
                    });
                } else {
                    selected = selected.filter((item) => !exclusiveValues.includes(item));
                }

                if (key === "discovery") {
                    if (value === "website") {
                        selected = selected.filter((item) => item !== "no_website");
                    }
                    if (value === "no_website") {
                        selected = selected.filter((item) => item !== "website");
                    }
                    if (selected.includes("no_online_presence") && [
                        "instagram", "facebook", "tiktok", "google_business",
                        "website", "directories"
                    ].includes(value)) {
                        selected = selected.filter((item) => item !== "no_online_presence");
                    }
                }

                if (key === "friction" && value !== "not_sure" && selected.includes("not_sure")) {
                    selected = selected.filter((item) => item !== "not_sure");
                }

                if (key === "friction" && selected.length >= 3) {
                    showError("Choose up to three challenges so the assessment can focus on the most important ones.");
                    return;
                }
                if (key === "discovery" && selected.length >= 8) {
                    showError("Choose up to eight discovery routes.");
                    return;
                }
                selected.push(value);
            }
            answers[key] = selected;
        }

        renderStep(value);
    }

    function showError(message) {
        stepError.textContent = message;
        stepError.hidden = false;
    }

    function validateStep() {
        const step = steps[stepIndex];
        const value = answers[step.key];
        const valid = Array.isArray(value) ? value.length > 0 : Boolean(value);

        if (!valid) {
            showError("Choose an option to continue. You can select “Not sure yet” where it is available.");
            return false;
        }
        return true;
    }

    function startAssessment() {
        intro.hidden = true;
        reportSection.hidden = true;
        assessment.hidden = false;
        stepIndex = 0;
        renderStep();
        assessment.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function resetAssessment() {
        answers.industry = "";
        answers.businessName = "";
        answers.location = "";
        answers.discovery = [];
        answers.contactMethods = [];
        answers.friction = [];
        answers.priority = "";
        stepIndex = 0;
        reportSection.hidden = true;
        assessment.hidden = true;
        intro.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function buildFindings() {
        const findings = [];
        const add = (id, title, text, services = []) => {
            findings.push({ id, title, text, services, evidence: "Self-reported" });
        };

        if (has("friction", "missed_followups")) {
            add(
                "enquiry_followthrough",
                "Make every enquiry easier to follow through",
                "You indicated that messages can be missed or follow-ups are difficult to keep track of. A clearer process for assigning the next action to each enquiry may help your team respond more consistently.",
                ["replies"]
            );
        }
        if (has("friction", "booking_admin")) {
            add(
                "booking_process",
                "Reduce friction in booking or order coordination",
                "You identified booking, appointment or order management as a challenge. Review how customers request a slot or place an order, what information you need from them, and how availability is confirmed.",
                ["booking"]
            );
        }
        if (has("friction", "repeated_questions")) {
            add(
                "repeated_questions",
                "Make common customer information easier to access",
                "You indicated that customers often need help with recurring questions. Clear, accessible answers about services, products, pricing or the next step may reduce unnecessary back-and-forth.",
                ["website", "replies"]
            );
        }
        if (has("friction", "hard_to_find")) {
            add(
                "discoverability",
                "Review how new customers discover the business",
                "You identified customer discovery as a challenge. The next step is to check whether your key business information is complete and easy to find on the channels your customers use.",
                ["google"]
            );
        }
        if (has("friction", "offer_clarity")) {
            add(
                "offer_clarity",
                "Explain the offer and next step more clearly",
                "You indicated that customers may need help understanding what you offer or how to proceed. Bringing the essential details together can make the decision process clearer.",
                ["website"]
            );
        }
        if (has("friction", "trust")) {
            add(
                "customer_confidence",
                "Give customers clearer reasons to feel confident",
                "You identified customer confidence as an area to improve. Consider how consistently you present your services, business details, examples of work and genuine customer feedback.",
                ["website", "reviews"]
            );
        }
        if (has("friction", "repeat_business")) {
            add(
                "repeat_business",
                "Review the experience after the first purchase or visit",
                "You identified repeat business as a priority. Map what happens after a customer buys or visits, including how you invite feedback and how you keep useful communication relevant. A specific solution should be scoped around your actual process."
            );
        }
        if (has("friction", "not_sure") || findings.length === 0) {
            add(
                "discovery_first",
                "Map the customer journey before choosing a solution",
                "Your answers do not yet point to one clear bottleneck. A useful first step is to map how people discover the business, ask questions, decide, buy or book, and return."
            );
        }

        if (has("discovery", "no_website") &&
            (has("friction", "offer_clarity") || has("friction", "repeated_questions") || answers.priority === "credibility")) {
            if (!findings.some((finding) => finding.services.includes("website"))) {
                add(
                    "central_information",
                    "Consider whether a central online home would help",
                    "You indicated that the business does not currently have a website. Because you also want clearer information or credibility, a focused website may be worth exploring. This is an opportunity to assess, not an assumption that every business needs a website.",
                    ["website"]
                );
            }
        }

        return findings;
    }

    function buildStrengths() {
        const selected = answers.discovery
            .filter((value) => value !== "no_website" && value !== "no_online_presence")
            .map((value) => getOptionLabel(discoveryOptions, value));

        const strengths = [];
        if (selected.length) {
            strengths.push("You identified these existing discovery routes: " + selected.join(", ") + ".");
        }
        if (has("contactMethods", "whatsapp")) {
            strengths.push("WhatsApp is already one of the ways customers can reach or transact with the business.");
        }
        if (has("contactMethods", "booking_tool")) {
            strengths.push("You already use an online booking or appointment tool.");
        }
        if (has("contactMethods", "online_checkout")) {
            strengths.push("Customers have an online checkout route available.");
        }
        if (has("discovery", "no_online_presence")) {
            strengths.push("You indicated that the business does not currently have an online presence.");
        } else if (has("discovery", "no_website")) {
            strengths.push("You indicated that the business does not currently have a website. That alone does not establish that a website should be the next investment.");
        }
        if (!strengths.length) {
            strengths.push("The answers do not yet establish which customer channels are working well. Confirming the channels customers actually use would be a useful starting point.");
        }
        return strengths;
    }

    function getWebsiteStatus() {
        if (has("discovery", "no_online_presence")) {
            return "No online presence reported";
        }
        if (has("discovery", "no_website")) {
            return "No website reported";
        }
        if (has("discovery", "website")) {
            return "Website reported; not inspected";
        }
        return "Website status not established";
    }

    function buildRecommendations(findings) {
        const serviceIds = [];
        findings.forEach((finding) => {
            finding.services.forEach((serviceId) => {
                if (!serviceIds.includes(serviceId)) serviceIds.push(serviceId);
            });
        });

        const recommendationDescriptions = {
            replies: "Review an assisted response workflow for common questions and clear human handover. For missed follow-ups, also agree who owns each enquiry and how the next action is tracked.",
            booking: "Map the information, availability and confirmations needed for a booking, then assess whether a structured booking or appointment system fits.",
            website: "Clarify the essential business information customers need and assess whether a focused website would make the offer and next step easier to understand.",
            google: has("discovery", "google_business")
                ? "Review the completeness and accuracy of the existing Google Business Profile before deciding what should be improved."
                : "Assess whether a Google Business Profile is appropriate for the business and, if so, establish or complete the listing with accurate information.",
            reviews: "Review how genuine customer feedback is requested and displayed. A review process should invite honest feedback, not require positive reviews."
        };

        return serviceIds.slice(0, 4).map((id) => ({
            ...serviceCatalogue[id],
            recommendation: recommendationDescriptions[id]
        }));
    }

    function renderReport() {
        const industry = getOptionLabel(industryOptions, answers.industry);
        const findings = buildFindings();
        const strengths = buildStrengths();
        const recommendations = buildRecommendations(findings);
        const businessName = answers.businessName.trim();
        const reportTitle = businessName
            ? "A clearer view of " + businessName
            : "A clearer view of your business";
        const channels = answers.discovery.map((value) => getOptionLabel(discoveryOptions, value));
        const priority = getOptionLabel(priorityOptions, answers.priority);

        const findingMarkup = findings.map((finding) => (
            '<article class="bof-finding">' +
                '<div class="bof-finding-top"><strong>' + escapeHtml(finding.title) + '</strong><span class="bof-evidence-tag">' + finding.evidence + '</span></div>' +
                '<p>' + escapeHtml(finding.text) + '</p>' +
            '</article>'
        )).join("");

        const recommendationMarkup = recommendations.length
            ? '<div class="bof-service-list">' + recommendations.map((item) =>
                '<a class="bof-service-link" href="' + item.href + '">' +
                    '<span><strong>' + escapeHtml(item.title) + '</strong><br><small>' + escapeHtml(item.recommendation) + '</small></span>' +
                    '<span aria-hidden="true">↗</span>' +
                '</a>'
            ).join("") + '</div>'
            : '<p>Your answers do not yet support a specific Swayphics service recommendation. Start by mapping the customer journey and identifying the point where customers need the most help.</p>';

        const locationMarkup = answers.location.trim()
            ? '<span class="bof-report-tag">' + escapeHtml(answers.location.trim()) + '</span>'
            : "";

        const channelsMarkup = channels.length
            ? channels.map((channel) => '<span class="bof-report-tag">' + escapeHtml(channel) + '</span>').join("")
            : '<span class="bof-report-tag">Not established</span>';
        const websiteStatusMarkup =
            '<span class="bof-report-tag">Website status: ' +
            escapeHtml(getWebsiteStatus()) + '</span>';

        reportContent.innerHTML =
            '<header class="bof-report-header">' +
                '<span class="bof-step-eyebrow">BUSINESS OPPORTUNITY FINDER / PREVIEW</span>' +
                '<h2>' + escapeHtml(reportTitle) + '</h2>' +
                '<p>This summary is based on the information you selected. It highlights practical areas to explore; it is not a verified audit or a promise of business results.</p>' +
                '<div class="bof-report-tags"><span class="bof-report-tag">' + escapeHtml(industry) + '</span>' + locationMarkup + '<span class="bof-report-tag">Priority: ' + escapeHtml(priority) + '</span></div>' +
            '</header>' +
            '<div class="bof-report-grid">' +
                '<section class="bof-report-card">' +
                    '<span class="bof-report-card-label">01 / Current starting point</span>' +
                    '<h3>Your current starting point</h3>' +
                    '<p>These are the channels and availability details you reported. Their quality or performance has not been independently checked.</p>' +
                    '<div class="bof-report-tags">' + channelsMarkup + websiteStatusMarkup + '</div>' +
                    '<ul class="bof-report-list">' + strengths.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>' +
                '</section>' +
                '<section class="bof-report-card">' +
                    '<span class="bof-report-card-label">02 / Customer journey</span>' +
                    '<h3>How customers take the next step</h3>' +
                    '<p>' + escapeHtml(answers.contactMethods.map((value) => getOptionLabel(contactOptions, value)).join(", ")) + '</p>' +
                    '<ul class="bof-report-list"><li>Most useful improvement should make the transition from interest to action clearer.</li><li>Keep the process suited to how customers already prefer to interact with the business.</li></ul>' +
                '</section>' +
                '<section class="bof-report-card bof-report-card--wide">' +
                    '<span class="bof-report-card-label">03 / Opportunities identified</span>' +
                    '<h3>Where attention may be most useful</h3>' +
                    '<p>Each item below comes from a challenge you selected. The evidence label matters: these are self-reported priorities, not independent findings.</p>' +
                    findingMarkup +
                '</section>' +
                '<section class="bof-report-card bof-report-card--wide">' +
                    '<span class="bof-report-card-label">04 / Practical next steps</span>' +
                    '<h3>Improvements worth exploring</h3>' +
                    '<p>These are potential directions to discuss and scope. The right solution depends on the business process, platforms and requirements.</p>' +
                    recommendationMarkup +
                '</section>' +
            '</div>';

        reportSection.hidden = false;
        assessment.hidden = true;
        intro.hidden = true;
        reportSection.scrollIntoView({ behavior: "smooth", block: "start" });

        const reportText = buildPlainTextReport(industry, findings, strengths, recommendations, priority);
        copyButton.dataset.reportText = reportText;
    }

    function buildPlainTextReport(industry, findings, strengths, recommendations, priority) {
        const lines = [
            "SWAYPHICS BUSINESS OPPORTUNITY FINDER",
            answers.businessName.trim() ? "Business: " + answers.businessName.trim() : "",
            "Industry: " + industry,
            answers.location.trim() ? "Location: " + answers.location.trim() : "",
            "Website status: " + getWebsiteStatus(),
            "Priority: " + getOptionLabel(priorityOptions, priority),
            "",
            "CURRENT STARTING POINT",
            ...strengths.map((item) => "- " + item),
            "",
            "OPPORTUNITIES IDENTIFIED"
        ];
        findings.forEach((finding) => {
            lines.push("- " + finding.title + " [Self-reported]: " + finding.text);
        });
        lines.push("", "POTENTIAL SERVICES TO EXPLORE");
        recommendations.forEach((item) => lines.push("- " + item.title + ": " + item.recommendation));
        lines.push("", "Preview only. Answers have not been independently verified. No website, social-media or Google Business Profile inspection has been performed.");
        return lines.filter((line) => line !== undefined).join("\n");
    }

    document.querySelectorAll("[data-bof-start]").forEach((button) => {
        button.addEventListener("click", startAssessment);
    });

    stepContent.addEventListener("click", (event) => {
        const button = event.target.closest("[data-select-option]");
        if (!button) return;
        toggleOption(button.dataset.selectOption, button.dataset.mode);
    });

    backButton.addEventListener("click", () => {
        if (stepIndex > 0) {
            stepIndex -= 1;
            renderStep();
        }
    });

    continueButton.addEventListener("click", () => {
        if (!validateStep()) return;

        if (stepIndex < stepCount - 1) {
            stepIndex += 1;
            renderStep();
            stepContent.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            renderReport();
        }
    });

    document.getElementById("bof-restart").addEventListener("click", resetAssessment);

    copyButton.addEventListener("click", async () => {
        const reportText = copyButton.dataset.reportText || "";
        if (!reportText) return;

        try {
            await navigator.clipboard.writeText(reportText);
            copyButton.textContent = "Report summary copied";
            window.setTimeout(() => {
                copyButton.textContent = "Copy report summary";
            }, 2200);
        } catch (error) {
            const temporary = document.createElement("textarea");
            temporary.value = reportText;
            temporary.setAttribute("readonly", "");
            temporary.style.position = "fixed";
            temporary.style.opacity = "0";
            document.body.appendChild(temporary);
            temporary.select();
            const copied = document.execCommand("copy");
            temporary.remove();
            copyButton.textContent = copied ? "Report summary copied" : "Copy unavailable";
            window.setTimeout(() => {
                copyButton.textContent = "Copy report summary";
            }, 2200);
        }
    });
})();