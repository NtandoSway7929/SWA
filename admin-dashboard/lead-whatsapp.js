/* Swayphics lead WhatsApp contact-link helper.
 * Uses the phone stored on the lead, populated from its assessment/contact details.
 * Never guesses an international destination for ambiguous phone numbers.
 */
(function (window) {
    "use strict";

    function normalizeLeadWhatsAppPhone(value) {
        let raw = String(value == null ? "" : value).trim();
        if (!raw) return "";

        // Remove only a clearly labelled extension; never append extension digits to a recipient.
        raw = raw.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "").trim();

        // Accept digits and ordinary phone-number punctuation only.
        if (!/^\s*(?:\+|00)?[\d\s().-]+\s*$/.test(raw)) return "";

        const hasPlus = /^\s*\+/.test(raw);
        const hasInternationalPrefix = /^\s*00/.test(raw);
        let digits = raw.replace(/\D/g, "");

        if (hasInternationalPrefix) {
            digits = digits.slice(2);
        } else if (!hasPlus) {
            // South African national-format numbers: 0 + 9 digits.
            if (digits.length === 10 && digits.startsWith("0")) {
                digits = "27" + digits.slice(1);
            // UK mobile numbers in national format: 07 + 9 digits.
            } else if (digits.length === 11 && digits.startsWith("07")) {
                digits = "44" + digits.slice(1);
            // A non-zero 11–15 digit number is treated as already including its country code.
            // Ten-digit numbers without a country code are ambiguous and intentionally rejected.
            } else if (!(digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0"))) {
                return "";
            }
        }

        if (!/^\d{8,15}$/.test(digits) || digits.startsWith("0")) return "";
        return digits;
    }

    function buildLeadWhatsAppUrl(phone) {
        const digits = normalizeLeadWhatsAppPhone(phone);
        return digits ? "https://wa.me/" + digits : "";
    }

    window.swayphicsLeadWhatsApp = Object.freeze({
        normalizePhone: normalizeLeadWhatsAppPhone,
        buildUrl: buildLeadWhatsAppUrl
    });
})(window);
