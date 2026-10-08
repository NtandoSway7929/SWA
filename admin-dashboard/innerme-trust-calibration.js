(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const BRIDGE_ID = "sway-ai-knowledge-intelligence-bridge";

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function token() {
        try { return localStorage.getItem(ACCESS_TOKEN_KEY) || ""; }
        catch (error) { return ""; }
    }

    function headers() {
        return {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + token(),
            "Content-Type": "application/json"
        };
    }

    async function request(path, options) {
        const response = await fetch(SUPABASE_URL + path, Object.assign({
            method: "GET",
            headers: headers()
        }, options || {}));
        const data = await response.json().catch(function () { return null; });
        if (!response.ok) {
            throw new Error(data && (data.message || data.error || data.hint)
                ? String(data.message || data.error || data.hint)
                : "InnerMe trust governance request failed.");
        }
        return data;
    }

    function rpc(name, body) {
        return request("/rest/v1/rpc/" + encodeURIComponent(name), {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(body || {})
        });
    }

    function prettyDate(value) {
        if (!value) return "Not recorded";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function pill(value) {
        const raw = String(value || "unknown");
        const tone = raw === "review_required" || raw === "pending"
            ? "review"
            : raw === "applied" || raw === "verified" || raw === "positive"
                ? "good"
                : raw === "rejected" || raw === "negative"
                    ? "bad" : "neutral";
        return '<span class="im-trust-pill ' + tone + '">' + esc(raw.replace(/_/g, " ")) + '</span>';
    }

    async function loadAgents() {
        return request("/rest/v1/innerme_agents?select=id,slug,name,trust_stage,status&status=eq.active&order=name.asc&limit=100");
    }

    async function loadEvidence() {
        return request("/rest/v1/innerme_agent_trust_evidence?select=id,evidence_key,agent_id,source_type,source_record_id,outcome_signal,confidence,quality_score,summary,evidence,evidence_status,created_by,verified_by,verified_at,created_at&order=created_at.desc&limit=100");
    }

    async function loadReviews() {
        return request("/rest/v1/innerme_trust_calibration_reviews?select=id,target_type,target_key,agent_id,strategy_key,current_trust_stage,proposed_trust_stage,sample_count,positive_count,neutral_count,negative_count,evidence_confidence,status,rationale,evidence_snapshot,condition_fingerprint,evidence_window_start,evidence_window_end,calculated_at,reviewed_by,reviewed_at,applied_at&order=calculated_at.desc&limit=100");
    }

    function injectStyles() {
        if (document.getElementById("im-trust-governance-styles")) return;
        const style = document.createElement("style");
        style.id = "im-trust-governance-styles";
        style.textContent =
            ".im-trust-governance{width:100%;margin:8px 0;color:inherit}" +
            ".im-trust-governance>summary{padding:10px;border-radius:11px;cursor:pointer;list-style:none;font-weight:750}" +
            ".im-trust-governance>summary::-webkit-details-marker{display:none}" +
            ".im-trust-wrap{display:grid;gap:10px;padding:8px 10px 12px}" +
            ".im-trust-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
            ".im-trust-muted{font-size:11px;line-height:1.5;opacity:.68;margin:0}" +
            ".im-trust-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}" +
            ".im-trust-metric{padding:10px;border:1px solid rgba(1,82,244,.12);border-radius:10px;background:rgba(1,82,244,.025);display:grid;gap:4px}" +
            ".im-trust-metric span{font-size:10px;opacity:.67}.im-trust-metric strong{font-size:19px}" +
            ".im-trust-section{display:grid;gap:8px;border:1px solid rgba(1,82,244,.10);border-radius:11px;padding:10px}" +
            ".im-trust-section h4{font-size:13px;margin:0}.im-trust-list{display:grid;gap:8px}" +
            ".im-trust-item{display:grid;gap:7px;padding:9px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.018);min-width:0}" +
            ".im-trust-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
            ".im-trust-item strong{font-size:12px}.im-trust-item p{font-size:11px;line-height:1.5;margin:0;overflow-wrap:anywhere}" +
            ".im-trust-item small{font-size:10px;opacity:.67;overflow-wrap:anywhere}" +
            ".im-trust-pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:750;text-transform:capitalize;background:rgba(100,116,139,.10);color:inherit}" +
            ".im-trust-pill.review{background:rgba(247,201,120,.18);color:#946200}.im-trust-pill.good{background:rgba(22,163,74,.12);color:#16803f}.im-trust-pill.bad{background:rgba(190,52,52,.12);color:#b42323}" +
            ".im-trust-actions{display:flex;gap:7px;flex-wrap:wrap}.im-trust-governance button{cursor:pointer}.im-trust-governance button:disabled{opacity:.55;cursor:wait}" +
            ".im-trust-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}" +
            ".im-trust-field{display:grid;gap:5px;min-width:0}.im-trust-field.full{grid-column:1/-1}" +
            ".im-trust-field label{font-size:10px;font-weight:700;opacity:.8}.im-trust-field input,.im-trust-field select,.im-trust-field textarea{width:100%;min-width:0;padding:9px;border:1px solid rgba(100,116,139,.28);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:11px;box-sizing:border-box}" +
            ".im-trust-field textarea{min-height:64px;resize:vertical}.im-trust-status{font-size:11px;line-height:1.5;min-height:14px;overflow-wrap:anywhere}.im-trust-status.error{color:#b42323}" +
            "body.sway-dark-mode .im-trust-metric,body.sway-dark-mode .im-trust-item{border-color:rgba(119,193,252,.14);background:rgba(119,193,252,.035)}" +
            "body.sway-dark-mode .im-trust-section{border-color:rgba(119,193,252,.14)}" +
            "body.sway-dark-mode .im-trust-pill.review{color:#ffd990}body.sway-dark-mode .im-trust-pill.good{color:#86efac}body.sway-dark-mode .im-trust-pill.bad{color:#ffb0b0}" +
            "@media(max-width:700px){.im-trust-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.im-trust-form{grid-template-columns:1fr}.im-trust-field.full{grid-column:auto}}";
        document.head.appendChild(style);
    }

    function render(panel, agents, evidence, reviews, message, isError) {
        const agentMap = new Map(agents.map(function (agent) { return [String(agent.id), agent]; }));
        const agentCounts = agents.reduce(function (acc, agent) {
            const stage = Number(agent.trust_stage || 1);
            acc["stage" + stage] = (acc["stage" + stage] || 0) + 1;
            return acc;
        }, { stage1: 0, stage2: 0, stage3: 0 });
        const pendingEvidence = evidence.filter(function (item) { return item.evidence_status === "pending"; });
        const pendingReviews = reviews.filter(function (item) { return item.status === "review_required"; });
        const formatTarget = function (item) {
            if (item.target_type === "agent") {
                const agent = agentMap.get(String(item.agent_id)) || {};
                return agent.name || item.target_key || "Registered agent";
            }
            return "Strategy · " + String(item.strategy_key || item.target_key || "unnamed");
        };

        const agentOptions = agents.map(function (agent) {
            return '<option value="' + esc(agent.id) + '">' + esc(agent.name) +
                ' · Stage ' + esc(agent.trust_stage) + '</option>';
        }).join("");

        const reviewHtml = reviews.length ? reviews.map(function (item) {
            const actionable = item.status === "review_required";
            const stageChange = Number(item.current_trust_stage) === Number(item.proposed_trust_stage)
                ? "No stage change proposed"
                : "Stage " + item.current_trust_stage + " → " + item.proposed_trust_stage;
            const evidenceSnapshot = item.evidence_snapshot && typeof item.evidence_snapshot === "object"
                ? item.evidence_snapshot : {};
            return '<article class="im-trust-item">' +
                '<div class="im-trust-item-head"><div><strong>' + esc(formatTarget(item)) + '</strong><p>' +
                esc(stageChange) + '</p></div>' + pill(item.status) + '</div>' +
                '<p>' + esc(item.rationale || "No rationale was recorded.") + '</p>' +
                '<small>' + esc(item.sample_count) + ' eligible outcomes · ' + esc(item.positive_count) +
                ' positive · ' + esc(item.neutral_count) + ' neutral · ' + esc(item.negative_count) +
                ' negative · ' + esc(item.evidence_confidence) + ' evidence confidence</small>' +
                '<small>Calculated ' + esc(prettyDate(item.calculated_at)) +
                (item.applied_at ? ' · Applied ' + esc(prettyDate(item.applied_at)) : "") + '</small>' +
                (evidenceSnapshot.permissions_change_on_approval === false || evidenceSnapshot.execution_authority_granted === false
                    ? '<small>Approval does not grant permissions or execution authority.</small>' : '') +
                (actionable ? '<div class="im-trust-actions">' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-im-trust-review="approve" data-im-trust-review-id="' + esc(item.id) + '">Approve stage change</button>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-im-trust-review="reject" data-im-trust-review-id="' + esc(item.id) + '">Reject</button>' +
                    '</div>' : '') +
                '</article>';
        }).join("") : '<p class="im-trust-muted">No calibration reviews have been recorded yet.</p>';

        const evidenceHtml = evidence.length ? evidence.map(function (item) {
            const agent = agentMap.get(String(item.agent_id)) || {};
            return '<article class="im-trust-item">' +
                '<div class="im-trust-item-head"><div><strong>' + esc(agent.name || "Registered agent") +
                '</strong><p>' + esc(item.outcome_signal) + ' · ' + esc(item.confidence) +
                ' confidence' + (item.quality_score == null ? "" : ' · quality ' + esc(item.quality_score) + '/100') +
                '</p></div>' + pill(item.evidence_status) + '</div>' +
                '<p>' + esc(item.summary || "") + '</p>' +
                '<small>' + esc(item.source_type.replace(/_/g, " ")) + ' · Recorded ' + esc(prettyDate(item.created_at)) +
                (item.verified_at ? ' · Verified ' + esc(prettyDate(item.verified_at)) : '') + '</small>' +
                (item.evidence && item.evidence.details ? '<small>Evidence details: ' + esc(item.evidence.details) + '</small>' : '') +
                (item.evidence_status === "pending"
                    ? '<div class="im-trust-actions">' +
                        '<button type="button" class="sway-ai-knowledge-test-button" data-im-evidence-review="verify" data-im-evidence-id="' + esc(item.id) + '">Verify evidence</button>' +
                        '<button type="button" class="sway-ai-knowledge-test-button" data-im-evidence-review="reject" data-im-evidence-id="' + esc(item.id) + '">Reject evidence</button>' +
                      '</div>' : '') +
                '</article>';
        }).join("") : '<p class="im-trust-muted">No trust evidence has been entered. Trust stages will remain unchanged until verified evidence exists.</p>';

        panel.innerHTML =
            '<details class="im-trust-governance" data-im-trust-panel open>' +
                '<summary>Autonomous Governance &amp; Trust Calibration</summary>' +
                '<div class="im-trust-wrap">' +
                    '<div class="im-trust-top"><p class="im-trust-muted">Review evidence behind trust decisions. Trust stages influence governance only; permissions and execution approval remain separate.</p>' +
                    '<div class="im-trust-actions"><button type="button" class="sway-ai-knowledge-test-button" data-im-trust-refresh>Recalculate trust</button></div></div>' +
                    '<div class="im-trust-metrics">' +
                        '<div class="im-trust-metric"><span>Active agents</span><strong>' + agents.length + '</strong></div>' +
                        '<div class="im-trust-metric"><span>Stage 1</span><strong>' + agentCounts.stage1 + '</strong></div>' +
                        '<div class="im-trust-metric"><span>Stage 2 / Stage 3</span><strong>' + agentCounts.stage2 + ' / ' + agentCounts.stage3 + '</strong></div>' +
                        '<div class="im-trust-metric"><span>Awaiting review</span><strong>' + (pendingEvidence.length + pendingReviews.length) + '</strong></div>' +
                    '</div>' +
                    '<section class="im-trust-section"><h4>Calibration proposals</h4>' +
                        '<p class="im-trust-muted">' + pendingReviews.length + ' proposal(s) require administrator review. No proposal executes an action.</p>' +
                        '<div class="im-trust-list">' + reviewHtml + '</div>' +
                    '</section>' +
                    '<section class="im-trust-section"><h4>Record administrator-assessed evidence</h4>' +
                        '<p class="im-trust-muted">Use a verifiable result, not task completion alone. New entries start pending and are excluded from calibration until verified.</p>' +
                        '<form class="im-trust-form" data-im-trust-evidence-form>' +
                            '<div class="im-trust-field full"><label for="im-trust-agent">Specialist agent</label><select id="im-trust-agent" name="agent_id" required>' + agentOptions + '</select></div>' +
                            '<div class="im-trust-field"><label for="im-trust-signal">Observed outcome</label><select id="im-trust-signal" name="outcome_signal" required>' +
                                '<option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option><option value="inconclusive">Inconclusive</option></select></div>' +
                            '<div class="im-trust-field"><label for="im-trust-confidence">Evidence confidence</label><select id="im-trust-confidence" name="confidence" required>' +
                                '<option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div>' +
                            '<div class="im-trust-field"><label for="im-trust-quality">Quality score (optional, 0–100)</label><input id="im-trust-quality" name="quality_score" type="number" min="0" max="100" step="1" placeholder="Leave blank if not assessed"></div>' +
                            '<div class="im-trust-field full"><label for="im-trust-summary">Evidence summary</label><textarea id="im-trust-summary" name="summary" maxlength="1200" required placeholder="Describe the observed result and how it was verified."></textarea></div>' +
                            '<div class="im-trust-field full"><label for="im-trust-details">Supporting detail (optional)</label><textarea id="im-trust-details" name="details" maxlength="2000" placeholder="Record a concise source, measurement or context. Do not paste passwords or credentials."></textarea></div>' +
                            '<div class="im-trust-field full"><div class="im-trust-actions"><button type="submit" class="sway-ai-knowledge-test-button">Submit for verification</button></div></div>' +
                        '</form>' +
                    '</section>' +
                    '<section class="im-trust-section"><h4>Trust evidence log</h4>' +
                        '<p class="im-trust-muted">Pending items are not used in calibration. Rejected and verified items remain visible for auditability.</p>' +
                        '<div class="im-trust-list">' + evidenceHtml + '</div>' +
                    '</section>' +
                    '<p class="im-trust-status' + (isError ? ' error' : '') + '" data-im-trust-status aria-live="polite">' + esc(message || "Trust governance loaded.") + '</p>' +
                '</div>' +
            '</details>';

        const form = panel.querySelector("[data-im-trust-evidence-form]");
        if (form && !agents.length) {
            form.querySelector("button[type=submit]").disabled = true;
        }
    }

    async function readState() {
        const results = await Promise.all([loadAgents(), loadEvidence(), loadReviews()]);
        return { agents: results[0], evidence: results[1], reviews: results[2] };
    }

    function boot() {
        injectStyles();
        const bridge = document.getElementById(BRIDGE_ID);
        if (!bridge) {
            window.setTimeout(boot, 450);
            return;
        }
        if (bridge.querySelector("[data-im-trust-panel]")) return;

        const host = document.createElement("div");
        host.setAttribute("data-im-trust-host", "");
        bridge.appendChild(host);

        async function load(message) {
            const statusMessage = message || "";
            try {
                const state = await readState();
                render(host, state.agents, state.evidence, state.reviews, statusMessage, false);
            } catch (error) {
                host.innerHTML = '<details class="im-trust-governance" open><summary>Autonomous Governance &amp; Trust Calibration</summary><div class="im-trust-wrap"><p class="im-trust-status error">' +
                    esc(error.message || "Unable to load trust governance.") + '</p><p class="im-trust-muted">Confirm the admin session is active, then reload the dashboard.</p></div></details>';
            }
        }

        async function setStatus(message, isError) {
            const node = host.querySelector("[data-im-trust-status]");
            if (node) {
                node.textContent = message;
                node.classList.toggle("error", Boolean(isError));
            }
        }

        host.addEventListener("submit", async function (event) {
            const form = event.target.closest("[data-im-trust-evidence-form]");
            if (!form) return;
            event.preventDefault();
            const data = new FormData(form);
            const button = form.querySelector('button[type="submit"]');
            const signal = String(data.get("outcome_signal") || "");
            const confidence = String(data.get("confidence") || "");
            const summary = String(data.get("summary") || "").trim();
            const scoreRaw = String(data.get("quality_score") || "").trim();
            const score = scoreRaw === "" ? null : Number(scoreRaw);
            const details = String(data.get("details") || "").trim();

            if (!summary || !["positive", "neutral", "negative", "inconclusive"].includes(signal) ||
                !["high", "medium", "low"].includes(confidence) ||
                (score !== null && (!Number.isInteger(score) || score < 0 || score > 100))) {
                await setStatus("Check the evidence summary, outcome, confidence and optional 0–100 quality score.", true);
                return;
            }

            button.disabled = true;
            try {
                await rpc("record_innerme_agent_trust_evidence", {
                    p_agent_id: String(data.get("agent_id") || ""),
                    p_source_type: "admin_assessment",
                    p_source_record_id: null,
                    p_outcome_signal: signal,
                    p_confidence: confidence,
                    p_quality_score: score,
                    p_summary: summary,
                    p_evidence: { details: details, method: "phase29_admin_dashboard_assessment" }
                });
                await load("Evidence submitted as pending. Verify it in the evidence log before recalculating trust.");
            } catch (error) {
                await setStatus(error.message || "Could not submit trust evidence.", true);
                button.disabled = false;
            }
        });

        host.addEventListener("click", async function (event) {
            const evidenceButton = event.target.closest("[data-im-evidence-review]");
            if (evidenceButton) {
                const decision = String(evidenceButton.getAttribute("data-im-evidence-review") || "");
                const evidenceId = String(evidenceButton.getAttribute("data-im-evidence-id") || "");
                if (!evidenceId || !["verify", "reject"].includes(decision)) return;
                const prompt = decision === "verify"
                    ? "Verify this trust evidence? Only verify it when the described outcome is supported by a source you have checked."
                    : "Reject this trust evidence? It will remain in the audit log but will not be used for calibration.";
                if (!window.confirm(prompt)) return;
                evidenceButton.disabled = true;
                try {
                    await rpc("review_innerme_agent_trust_evidence", {
                        p_evidence_id: evidenceId, p_decision: decision
                    });
                    if (decision === "verify") {
                        await rpc("refresh_innerme_agent_trust_calibration", {});
                    }
                    await load(decision === "verify"
                        ? "Evidence verified. Trust calibration has been recalculated; any stage change still requires approval."
                        : "Evidence rejected and retained in the audit log.");
                } catch (error) {
                    await setStatus(error.message || "Evidence review failed.", true);
                    evidenceButton.disabled = false;
                }
                return;
            }

            const reviewButton = event.target.closest("[data-im-trust-review]");
            if (reviewButton) {
                const decision = String(reviewButton.getAttribute("data-im-trust-review") || "");
                const reviewId = String(reviewButton.getAttribute("data-im-trust-review-id") || "");
                if (!reviewId || !["approve", "reject"].includes(decision)) return;
                const prompt = decision === "approve"
                    ? "Approve this proposed trust-stage change? This will change the recorded stage only, not registered permissions or execution authority."
                    : "Reject this trust-stage proposal? The current stage and permissions will remain unchanged.";
                if (!window.confirm(prompt)) return;
                reviewButton.disabled = true;
                try {
                    await rpc("review_innerme_trust_calibration", {
                        p_calibration_id: reviewId, p_decision: decision
                    });
                    if (decision === "approve") {
                        await rpc("run_innerme_incident_intelligence", {});
                    }
                    await load(decision === "approve"
                        ? "Trust-stage change approved. The integrated intelligence pipeline has refreshed."
                        : "Calibration proposal rejected. The existing trust stage remains unchanged.");
                } catch (error) {
                    await setStatus(error.message || "Calibration review failed.", true);
                    reviewButton.disabled = false;
                }
                return;
            }

            const refreshButton = event.target.closest("[data-im-trust-refresh]");
            if (refreshButton) {
                refreshButton.disabled = true;
                refreshButton.textContent = "Recalculating…";
                try {
                    const created = await rpc("refresh_innerme_agent_trust_calibration", {});
                    await load("Calibration refresh completed. " + String(Number(created || 0)) +
                        " new calibration review record(s) created; permissions and execution gates are unchanged.");
                } catch (error) {
                    await setStatus(error.message || "Trust recalculation failed.", true);
                    refreshButton.disabled = false;
                    refreshButton.textContent = "Recalculate trust";
                }
            }
        });

        load("Trust governance ready.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();