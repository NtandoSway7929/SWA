(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const PANEL_ID = "sway-ai-knowledge-intelligence-bridge";

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function token() {
        try {
            return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
        } catch (error) {
            return "";
        }
    }

    async function analyse() {
        const accessToken = token();
        if (!accessToken) {
            throw new Error("Admin session is unavailable. Please sign in again.");
        }

        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/analyze_innerme_knowledge",
            {
                method: "POST",
                headers: {
                    apikey: SUPABASE_PUBLISHABLE_KEY,
                    Authorization: "Bearer " + accessToken,
                    "Content-Type": "application/json"
                },
                body: "{}"
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Knowledge intelligence analysis failed."
            );
        }

        return data;
    }

    function authHeaders() {
        return {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + token(),
            "Content-Type": "application/json"
        };
    }

    async function loadVerificationQueue() {
        const accessToken = token();
        if (!accessToken) {
            throw new Error("Admin session is unavailable. Please sign in again.");
        }

        const knowledgeResponse = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_knowledge?select=id,slug,title,domain,knowledge_type,statement,application,constraints,do_not_use_when,evidence_level,confidence,jurisdiction,priority,source_id,verification_status,verification_method,verification_notes,last_verified_at,review_after,embedding_status,updated_at&status=eq.active&order=updated_at.desc&limit=100",
            {
                method: "GET",
                headers: authHeaders()
            }
        );

        const knowledgeData = await knowledgeResponse.json().catch(function () {
            return null;
        });

        if (!knowledgeResponse.ok) {
            throw new Error(
                knowledgeData && (knowledgeData.message || knowledgeData.error || knowledgeData.hint)
                    ? String(knowledgeData.message || knowledgeData.error || knowledgeData.hint)
                    : "Unable to load InnerMe verification queue."
            );
        }

        const sourceResponse = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_knowledge_sources?select=id,name,publisher,source_type,authority_level,status,verification_status,url&status=eq.active&order=authority_level.asc,name.asc&limit=50",
            {
                method: "GET",
                headers: authHeaders()
            }
        );

        const sourceData = await sourceResponse.json().catch(function () {
            return [];
        });

        if (!sourceResponse.ok) {
            throw new Error(
                sourceData && (sourceData.message || sourceData.error || sourceData.hint)
                    ? String(sourceData.message || sourceData.error || sourceData.hint)
                    : "Unable to load InnerMe knowledge sources."
            );
        }

        const sources = new Map();
        (Array.isArray(sourceData) ? sourceData : []).forEach(function (source) {
            sources.set(String(source.id || ""), source);
        });

        return (Array.isArray(knowledgeData) ? knowledgeData : [])
            .filter(function (item) {
                const status = String(item && item.verification_status || "").trim();
                const reviewAfter = item && item.review_after
                    ? new Date(item.review_after).getTime()
                    : NaN;

                return (
                    status !== "verified" ||
                    (Number.isFinite(reviewAfter) && reviewAfter <= Date.now())
                );
            })
            .map(function (item) {
                return Object.assign({}, item, {
                    source_record: sources.get(String(item.source_id || "")) || null
                });
            });
    }

    function verificationMethodFor(source) {
        const type = String(source && source.source_type || "").trim();

        if (type === "primary_authority") {
            return "official_source_confirmation";
        }

        if (type === "established_framework") {
            return "source_recheck";
        }

        if (type === "practitioner") {
            return "practitioner_source_recheck";
        }

        if (type === "internal") {
            return "internal_review";
        }

        return "manual_review";
    }

    function verificationMethodLabel(method) {
        const labels = {
            official_source_confirmation: "Official source confirmation",
            source_recheck: "Source re-check",
            practitioner_source_recheck: "Practitioner source re-check",
            internal_review: "Internal review",
            manual_review: "Manual review"
        };

        return labels[method] || "Manual review";
    }

    function renderVerificationQueue(items) {
        if (!items.length) {
            return '<p class="sway-ai-ki-good">No active InnerMe knowledge records are currently waiting for source verification.</p>';
        }

        return items.map(function (item) {
            const source = item.source_record || {};
            const method = verificationMethodFor(source);
            const sourceUrl = String(source.url || item.verified_source_url || "").trim();
            const safeHttpUrl = /^https?:\\/\\//i.test(sourceUrl);
            const status = String(item.verification_status || "unverified");

            return (
                '<article class="sway-ai-ki-verification-item">' +
                    '<div class="sway-ai-ki-verification-head">' +
                        '<div>' +
                            '<strong>' + esc(item.title || "Untitled knowledge") + '</strong>' +
                            '<span>' + esc(item.domain || "Unclassified") + ' · ' + esc(item.knowledge_type || "knowledge") + '</span>' +
                        '</div>' +
                        '<em>' + esc(status.replace(/_/g, " ")) + '</em>' +
                    '</div>' +
                    '<p class="sway-ai-ki-verification-statement">' +
                        esc(item.statement || "") +
                    '</p>' +
                    '<div class="sway-ai-ki-verification-source">' +
                        '<strong>' + esc(source.name || "Source record unavailable") + '</strong>' +
                        (
                            source.publisher
                                ? '<span>' + esc(source.publisher) + '</span>'
                                : ""
                        ) +
                        (
                            source.url
                                ? (
                                    safeHttpUrl
                                        ? '<a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Open source ↗</a>'
                                        : '<span>' + esc(sourceUrl) + '</span>'
                                  )
                                : '<span>No source URL recorded</span>'
                        ) +
                    '</div>' +
                    '<div class="sway-ai-ki-verification-meta">' +
                        '<span>Evidence: ' + esc(item.evidence_level || "unknown") + '</span>' +
                        '<span>Verification method: ' + esc(verificationMethodLabel(method)) + '</span>' +
                        '<span>Excluded from retrieval until verified and indexed</span>' +
                    '</div>' +
                    '<div class="sway-ai-ki-verification-actions">' +
                        '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-verify="' +
                            esc(String(item.id || "")) +
                        '">Verify &amp; re-index</button>' +
                    '</div>' +
                '</article>'
            );
        }).join("");
    }

    async function verifyAndReindex(knowledgeId, items) {
        const id = String(knowledgeId || "").trim();
        if (!id) {
            return;
        }

        const item = (items || []).find(function (entry) {
            return String(entry && entry.id || "") === id;
        });

        if (!item) {
            return;
        }

        const source = item.source_record || {};
        const sourceUrl = String(source.url || item.verified_source_url || "").trim();
        const method = verificationMethodFor(source);

        const confirmed = window.confirm(
            "Confirm that you checked this knowledge record against the listed source and that the statement is supported by that source.\n\n" +
            String(item.title || "InnerMe knowledge")
        );

        if (!confirmed) {
            return;
        }

        const button = document.querySelector(
            '[data-sway-ai-ki-verify="' + CSS.escape(id) + '"]'
        );

        if (button) {
            button.disabled = true;
            button.textContent = "Verifying…";
        }

        try {
            const verificationNotes =
                "Verified by a Swayphics admin against the listed source on " +
                new Date().toISOString().slice(0, 10) +
                ". Source: " +
                (source.name || sourceUrl || "recorded source") +
                ".";

            const verifyResponse = await fetch(
                SUPABASE_URL + "/rest/v1/rpc/verify_innerme_knowledge",
                {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                        p_knowledge_id: id,
                        p_verification_method: method,
                        p_verification_notes: verificationNotes,
                        p_verified_source_url: sourceUrl || null
                    })
                }
            );

            const verifyData = await verifyResponse.json().catch(function () {
                return null;
            });

            if (!verifyResponse.ok) {
                throw new Error(
                    verifyData && (verifyData.message || verifyData.error || verifyData.hint)
                        ? String(verifyData.message || verifyData.error || verifyData.hint)
                        : "InnerMe knowledge verification failed."
                );
            }

            if (button) {
                button.textContent = "Indexing…";
            }

            const embedResponse = await fetch(
                SUPABASE_URL + "/functions/v1/swayphics-ai",
                {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                        action: "embed_knowledge",
                        knowledge_ids: [id]
                    })
                }
            );

            const embedData = await embedResponse.json().catch(function () {
                return null;
            });

            if (!embedResponse.ok) {
                throw new Error(
                    embedData && (embedData.message || embedData.error || embedData.hint)
                        ? String(embedData.message || embedData.error || embedData.hint)
                        : "The verified InnerMe knowledge could not be re-indexed."
                );
            }

            const statusResponse = await fetch(
                SUPABASE_URL +
                    "/rest/v1/innerme_knowledge?id=eq." +
                    encodeURIComponent(id) +
                    "&select=id,verification_status,embedding_status,embedded_at,review_after&limit=1",
                {
                    method: "GET",
                    headers: authHeaders()
                }
            );

            const statusData = await statusResponse.json().catch(function () {
                return [];
            });

            const row = Array.isArray(statusData) ? statusData[0] : null;

            if (!row || row.verification_status !== "verified") {
                throw new Error("Verification completed, but the record did not return as verified.");
            }

            const retrievalResponse = await fetch(
                SUPABASE_URL + "/functions/v1/swayphics-ai",
                {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                        action: "search_knowledge",
                        query:
                            String(item.title || "") +
                            "\n" +
                            String(item.statement || ""),
                        match_threshold: 0,
                        match_count: 20
                    })
                }
            );

            const retrievalData = await retrievalResponse.json().catch(function () {
                return null;
            });

            const retrievalMatches =
                retrievalData && Array.isArray(retrievalData.matches)
                    ? retrievalData.matches
                    : [];

            const retrieved =
                retrievalMatches.some(function (match) {
                    return String(match && match.id || "") === id;
                });

            if (!row.embedded_at || row.embedding_status !== "ready") {
                window.alert(
                    "Source verified. The record is not yet indexed as ready, so InnerMe will continue excluding it from retrieval until indexing completes."
                );
            } else if (!retrieved) {
                window.alert(
                    "Source verified and indexed successfully. The retrieval smoke test did not return this record in its top results, so review retrieval relevance before relying on it."
                );
            } else {
                window.alert(
                    "Source verified, re-indexed and confirmed retrievable by the knowledge search."
                );
            }

            const details = document.getElementById(PANEL_ID);
            if (details) {
                const results = details.querySelector(".sway-ai-ki-verification-results");
                if (results) {
                    const refreshed = await loadVerificationQueue();
                    results.innerHTML = renderVerificationQueue(refreshed);
                    results.dataset.items = JSON.stringify(refreshed.map(function (entry) {
                        return entry.id;
                    }));
                    results.__swayVerificationItems = refreshed;
                }
            }
        } catch (error) {
            if (button) {
                button.disabled = false;
                button.textContent = "Verify & re-index";
            }

            window.alert(
                error.message || "InnerMe source verification failed."
            );
        }
    }

    function render(report) {
        const summary = report && report.summary ? report.summary : {};
        const domains = Array.isArray(report && report.coverage_by_domain)
            ? report.coverage_by_domain
            : [];
        const overlaps = Array.isArray(report && report.semantic_overlaps)
            ? report.semantic_overlaps
            : [];
        const conflicts = Array.isArray(report && report.potential_conflicts)
            ? report.potential_conflicts
            : [];
        const recommendations = Array.isArray(report && report.recommendations)
            ? report.recommendations
            : [];

        const metric = function (label, value) {
            return (
                '<div class="sway-ai-ki-metric">' +
                    '<span>' + esc(label) + '</span>' +
                    '<strong>' + esc(value) + '</strong>' +
                '</div>'
            );
        };

        const domainHtml = domains.length
            ? '<div class="sway-ai-ki-list">' +
                domains.map(function (item) {
                    return (
                        '<div class="sway-ai-ki-row">' +
                            '<span>' + esc(item.domain || "Unclassified") + '</span>' +
                            '<strong>' +
                                esc(String(item.retrievable || 0)) +
                                '/' +
                                esc(String(item.count || 0)) +
                            '</strong>' +
                        '</div>'
                    );
                }).join("") +
              '</div>'
            : '<p class="sway-ai-ki-muted">No domain data yet.</p>';

        const signals = [
            Number(summary.stale_knowledge || 0)
                ? "Stale: " + summary.stale_knowledge
                : "",
            Number(summary.semantic_overlaps || 0)
                ? "Overlap: " + summary.semantic_overlaps
                : "",
            Number(summary.potential_conflicts || 0)
                ? "Potential conflicts: " + summary.potential_conflicts
                : ""
        ].filter(Boolean);

        return (
            '<div class="sway-ai-ki-metrics">' +
                metric("Coverage", String(summary.retrieval_coverage_pct || 0) + "%") +
                metric("Retrievable", String(summary.retrievable_knowledge || 0)) +
                metric("Stale", String(summary.stale_knowledge || 0)) +
                metric("Overlap", String(summary.semantic_overlaps || 0)) +
                metric("Conflicts", String(summary.potential_conflicts || 0)) +
                metric("Feedback", String(summary.feedback_records || 0)) +
            '</div>' +
            '<div class="sway-ai-ki-section">' +
                '<strong>Domain coverage</strong>' +
                '<span>Retrievable / total records</span>' +
                domainHtml +
            '</div>' +
            '<div class="sway-ai-ki-section">' +
                '<strong>Attention signals</strong>' +
                (
                    signals.length
                        ? '<p class="sway-ai-ki-signals">' + esc(signals.join(" · ")) + '</p>'
                        : '<p class="sway-ai-ki-good">No current warnings detected.</p>'
                ) +
            '</div>' +
            (
                recommendations.length
                    ? '<div class="sway-ai-ki-section"><strong>Recommended next moves</strong><ul>' +
                        recommendations.slice(0, 3).map(function (item) {
                            return '<li>' + esc(item) + '</li>';
                        }).join("") +
                      '</ul></div>'
                    : ""
            ) +
            '<small class="sway-ai-ki-foot">' +
                esc(
                    overlaps.length || conflicts.length
                        ? "Similarity flags are advisory and require human review."
                        : "Advisory only. No knowledge or retrieval state was changed."
                ) +
            '</small>'
        );
    }

    async function analyseKnowledgeGaps() {
        const response = await fetch(SUPABASE_URL + "/functions/v1/swayphics-ai", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ action: "generate_knowledge_gap_candidates" })
        });
        const data = await response.json().catch(function(){ return null; });
        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Knowledge-gap analysis failed."
            );
        }
        return data;
    }

    async function loadKnowledgeGapQueue() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/innerme_knowledge_gaps?select=id,title,gap_statement,domain,jurisdiction,why_needed,evidence_basis,recommended_evidence_level,recommended_source_type,acquisition_target,example_queries,source_signals,demand_count,priority,confidence,status,reviewed_at,created_at,updated_at&status=in.(candidate,approved)&order=priority.desc,created_at.desc&limit=50",
            { method:"GET", headers:authHeaders() }
        );
        const data = await response.json().catch(function(){ return []; });
        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load the knowledge-gap queue."
            );
        }
        return Array.isArray(data) ? data : [];
    }

    async function loadAcquisitionTasks() {
        const taskResponse = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_knowledge_acquisition_tasks?select=id,gap_id,source_id,source_excerpt,acquisition_notes,status,source_verified_at,knowledge_drafted_at,knowledge_draft_id,published_at,created_at,updated_at&status=neq.dismissed&order=created_at.desc&limit=50",
            { method:"GET", headers:authHeaders() }
        );
        const tasks = await taskResponse.json().catch(function(){ return []; });
        if (!taskResponse.ok) {
            throw new Error(tasks && (tasks.message || tasks.error || tasks.hint) ? String(tasks.message || tasks.error || tasks.hint) : "Unable to load acquisition tasks.");
        }

        const gapResponse = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_knowledge_gaps?select=id,title,gap_statement,domain,jurisdiction,acquisition_target,recommended_source_type,recommended_evidence_level,priority,status&order=priority.desc&limit=100",
            { method:"GET", headers:authHeaders() }
        );
        const gaps = await gapResponse.json().catch(function(){ return []; });
        if (!gapResponse.ok) {
            throw new Error(gaps && (gaps.message || gaps.error || gaps.hint) ? String(gaps.message || gaps.error || gaps.hint) : "Unable to load approved knowledge gaps.");
        }

        const sourceIds=(Array.isArray(tasks)?tasks:[]).map(function(task){return String(task.source_id || "").trim();}).filter(Boolean);
        let sources=[];
        if(sourceIds.length){
            const sourceResponse=await fetch(
                SUPABASE_URL+"/rest/v1/innerme_knowledge_sources?select=id,name,publisher,source_type,authority_level,jurisdiction,url,licence_status,usage_notes,status,verification_status,last_verified_at,review_after&id=in."+sourceIds.join(","),
                {method:"GET",headers:authHeaders()}
            );
            sources=await sourceResponse.json().catch(function(){return [];});
            if(!sourceResponse.ok){
                throw new Error(sources && (sources.message || sources.error || sources.hint) ? String(sources.message || sources.error || sources.hint) : "Unable to load acquisition sources.");
            }
        }

        const gapMap=new Map((Array.isArray(gaps)?gaps:[]).map(function(gap){return [String(gap.id || ""),gap];}));
        const sourceMap=new Map((Array.isArray(sources)?sources:[]).map(function(source){return [String(source.id || ""),source];}));

        return (Array.isArray(tasks)?tasks:[]).map(function(task){
            return Object.assign({},task,{
                gap:gapMap.get(String(task.gap_id || "")) || null,
                source:sourceMap.get(String(task.source_id || "")) || null
            });
        });
    }

    function renderAcquisitionSourceForm(task) {
        const gap=task.gap || {};
        const source=task.source || {};
        const taskId=String(task.id || "");
        const sourceType=String(source.source_type || gap.recommended_source_type || "practitioner");
        return '<form class="sway-ai-ki-acquisition-form" data-sway-ai-ki-acquisition-form="' + esc(taskId) + '">' +
            '<div class="sway-ai-ki-acquisition-form-grid">' +
                '<label><span>Source name</span><input name="name" required value="' + esc(source.name || "") + '" placeholder="e.g. SARS Small Business..." /></label>' +
                '<label><span>Publisher</span><input name="publisher" required value="' + esc(source.publisher || "") + '" placeholder="Publisher / organisation" /></label>' +
                '<label><span>Source type</span><select name="source_type">' +
                    ["primary_authority","established_framework","academic","practitioner","internal"].map(function(value){
                        return '<option value="' + value + '"' + (sourceType===value ? " selected" : "") + '>' + value.replace(/_/g," ") + '</option>';
                    }).join("") +
                '</select></label>' +
                '<label><span>Authority level</span><select name="authority_level">' +
                    [1,2,3,4,5].map(function(value){return '<option value="'+value+'"'+(Number(source.authority_level || (value===3 ? 3 : 0))===value ? " selected" : "")+'>'+value+'</option>';}).join("") +
                '</select></label>' +
                '<label><span>Jurisdiction</span><input name="jurisdiction" value="' + esc(source.jurisdiction || gap.jurisdiction || "Global") + '" /></label>' +
                '<label><span>Licence status</span><select name="licence_status">' +
                    ["open","permission_required","proprietary","unknown","internal"].map(function(value){
                        return '<option value="' + value + '"' + (String(source.licence_status || "unknown")===value ? " selected" : "") + '>' + value.replace(/_/g," ") + '</option>';
                    }).join("") +
                '</select></label>' +
                '<label class="sway-ai-ki-acquisition-wide"><span>Source URL</span><input name="url" type="url" required value="' + esc(source.url || "") + '" placeholder="https://..." /></label>' +
                '<label class="sway-ai-ki-acquisition-wide"><span>Relevant source excerpt</span><textarea name="source_excerpt" required minlength="50" placeholder="Paste the portion of the verified source that supports the gap.">' + esc(task.source_excerpt || "") + '</textarea></label>' +
                '<label class="sway-ai-ki-acquisition-wide"><span>Usage notes</span><textarea name="usage_notes" placeholder="Scope, access notes, page/section details, licensing notes.">' + esc(source.usage_notes || task.acquisition_notes || "") + '</textarea></label>' +
            '</div>' +
            '<div class="sway-ai-ki-gap-actions"><button type="submit" class="sway-ai-knowledge-test-button">Save source, verify &amp; draft</button></div>' +
        '</form>';
    }

    function renderAcquisitionQueue(items) {
        if(!items.length) {
            return '<p class="sway-ai-ki-muted">No acquisition tasks yet. Approve a knowledge gap to create one automatically.</p>';
        }

        return items.map(function(task){
            const gap=task.gap || {};
            const source=task.source || {};
            const status=String(task.status || "open");
            const taskId=String(task.id || "");

            let body="";
            if(status==="open" || status==="source_identified") {
                body=renderAcquisitionSourceForm(task);
            } else if(status==="source_verified") {
                body='<p class="sway-ai-ki-good">Source verified. Generate the draft knowledge record from the supplied source excerpt.</p>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-acq-draft="'+esc(taskId)+'">Generate knowledge draft</button>';
            } else if(status==="knowledge_drafted") {
                body='<div class="sway-ai-ki-acquisition-draft" data-sway-ai-ki-acq-draft-view="'+esc(taskId)+'"><p class="sway-ai-ki-muted">Knowledge draft is ready. It must be verified against the source and successfully indexed before publication.</p>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-acq-publish="'+esc(taskId)+'">Verify, index &amp; publish</button></div>';
            } else if(status==="published") {
                body='<p class="sway-ai-ki-good">Published into active InnerMe knowledge and eligible for retrieval.</p>';
            }

            return '<article class="sway-ai-ki-acquisition-item">' +
                '<div class="sway-ai-ki-acquisition-head"><div><strong>'+esc(gap.title || "Knowledge acquisition task")+'</strong><span>'+esc(gap.domain || "Unclassified")+(gap.jurisdiction ? " · "+esc(gap.jurisdiction) : "")+'</span></div><em>'+esc(status.replace(/_/g," "))+'</em></div>' +
                '<p class="sway-ai-ki-gap-statement">'+esc(gap.gap_statement || "")+'</p>' +
                '<div class="sway-ai-ki-acquisition-meta"><span>Priority: P'+esc(gap.priority || 50)+'</span><span>Target: '+esc(gap.acquisition_target || "Verified source")+'</span>'+(source.name ? '<span>Source: '+esc(source.name)+'</span>' : "")+'</div>' +
                body +
            '</article>';
        }).join("");
    }

    async function saveAcquisitionSource(taskId, form) {
        const id=String(taskId || "").trim();
        if(!id || !form) return;

        const button=form.querySelector("button[type=submit]");
        const data=new FormData(form);
        const name=String(data.get("name") || "").trim();
        const publisher=String(data.get("publisher") || "").trim();
        const sourceType=String(data.get("source_type") || "practitioner").trim();
        const authorityLevel=Math.max(1,Math.min(5,Number(data.get("authority_level") || 3)));
        const jurisdiction=String(data.get("jurisdiction") || "Global").trim();
        const licenceStatus=String(data.get("licence_status") || "unknown").trim();
        const url=String(data.get("url") || "").trim();
        const excerpt=String(data.get("source_excerpt") || "").trim();
        const usageNotes=String(data.get("usage_notes") || "").trim();

        if(excerpt.length<50){
            window.alert("The relevant source excerpt must contain at least 50 characters.");
            return;
        }
        if(!/^https?:\/\//i.test(url)){
            window.alert("Use a valid HTTP or HTTPS source URL.");
            return;
        }

        if(button){button.disabled=true;button.textContent="Verifying source…";}

        try{
            const sourceSlug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70)+"-"+id.slice(0,8);
            const sourceResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_knowledge_sources",{
                method:"POST",
                headers:Object.assign({},authHeaders(),{"Prefer":"return=representation"}),
                body:JSON.stringify({
                    slug:sourceSlug,
                    name:name,
                    publisher:publisher,
                    source_type:sourceType,
                    authority_level:authorityLevel,
                    jurisdiction:jurisdiction || null,
                    url:url,
                    licence_status:licenceStatus,
                    usage_notes:usageNotes || null,
                    tags:[],
                    status:"active",
                    verification_status:"unverified"
                })
            });
            const sourceData=await sourceResponse.json().catch(function(){return [];});
            if(!sourceResponse.ok || !Array.isArray(sourceData) || !sourceData[0]){
                throw new Error(sourceData && (sourceData.message || sourceData.error || sourceData.hint) ? String(sourceData.message || sourceData.error || sourceData.hint) : "The acquisition source could not be saved.");
            }
            const sourceRow=sourceData[0];

            const taskResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_knowledge_acquisition_tasks?id=eq."+encodeURIComponent(id),{
                method:"PATCH",
                headers:Object.assign({},authHeaders(),{"Prefer":"return=representation"}),
                body:JSON.stringify({
                    source_id:sourceRow.id,
                    source_excerpt:excerpt,
                    acquisition_notes:usageNotes || null,
                    status:"source_identified",
                    updated_at:new Date().toISOString()
                })
            });
            const taskData=await taskResponse.json().catch(function(){return [];});
            if(!taskResponse.ok){
                throw new Error(taskData && (taskData.message || taskData.error || taskData.hint) ? String(taskData.message || taskData.error || taskData.hint) : "The acquisition task could not be updated.");
            }

            if(button){button.textContent="Verifying source…";}
            const verifyResponse=await fetch(SUPABASE_URL+"/rest/v1/rpc/verify_innerme_acquisition_source",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({
                    p_task_id:id,
                    p_verification_notes:"Source reviewed by a Swayphics admin against the supplied source URL and excerpt on "+new Date().toISOString().slice(0,10)+"."
                })
            });
            const verifyData=await verifyResponse.json().catch(function(){return null;});
            if(!verifyResponse.ok){
                throw new Error(verifyData && (verifyData.message || verifyData.error || verifyData.hint) ? String(verifyData.message || verifyData.error || verifyData.hint) : "Source verification failed.");
            }

            if(button){button.textContent="Drafting knowledge…";}
            const draftResponse=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({action:"generate_knowledge_draft",acquisition_task_id:id,source_excerpt:excerpt})
            });
            const draftData=await draftResponse.json().catch(function(){return null;});
            if(!draftResponse.ok){
                throw new Error(draftData && (draftData.message || draftData.error || draftData.hint) ? String(draftData.message || draftData.error || draftData.hint) : "Knowledge draft generation failed.");
            }

            window.alert("Source verified and a draft knowledge record was created. Verify, index and publish it from the acquisition task.");
            const container=form.closest(".sway-ai-ki-gaps-results");
            if(container){
                const items=await loadAcquisitionTasks();
                container.innerHTML=renderAcquisitionQueue(items);
                container.__swayAcquisitionItems=items;
            }
        }catch(error){
            window.alert(error.message || "Knowledge acquisition failed.");
            if(button){button.disabled=false;button.textContent="Save source, verify & draft";}
        }
    }

    async function generateAcquisitionDraft(taskId,container) {
        const id=String(taskId || "").trim();
        if(!id) return;
        const button=document.querySelector('[data-sway-ai-ki-acq-draft="'+CSS.escape(id)+'"]');
        if(button){button.disabled=true;button.textContent="Drafting…";}
        try{
            const items=Array.isArray(container.__swayAcquisitionItems) ? container.__swayAcquisitionItems : [];
            const task=items.find(function(entry){return String(entry.id || "")===id;});
            if(!task) throw new Error("The acquisition task could not be loaded.");
            const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({action:"generate_knowledge_draft",acquisition_task_id:id,source_excerpt:task.source_excerpt || ""})
            });
            const data=await response.json().catch(function(){return null;});
            if(!response.ok) throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Knowledge draft generation failed.");
            const nextItems=await loadAcquisitionTasks();
            container.innerHTML=renderAcquisitionQueue(nextItems);
            container.__swayAcquisitionItems=nextItems;
        }catch(error){
            window.alert(error.message || "Knowledge draft generation failed.");
            if(button){button.disabled=false;button.textContent="Generate knowledge draft";}
        }
    }

    async function verifyIndexAndPublish(taskId,container) {
        const id=String(taskId || "").trim();
        if(!id) return;
        if(!window.confirm("Confirm that you reviewed the generated knowledge draft against the verified source excerpt. InnerMe will then verify it, index it, and publish it to active retrieval.")) return;

        const items=Array.isArray(container.__swayAcquisitionItems) ? container.__swayAcquisitionItems : [];
        const task=items.find(function(entry){return String(entry.id || "")===id;});
        if(!task || !task.knowledge_draft_id) {
            window.alert("The knowledge draft could not be identified.");
            return;
        }

        const button=document.querySelector('[data-sway-ai-ki-acq-publish="'+CSS.escape(id)+'"]');
        if(button){button.disabled=true;button.textContent="Verifying…";}

        try{
            const verifyResponse=await fetch(SUPABASE_URL+"/rest/v1/rpc/verify_innerme_knowledge",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({
                    p_knowledge_id:task.knowledge_draft_id,
                    p_verification_method:"acquisition_knowledge_review",
                    p_verification_notes:"Draft reviewed by a Swayphics admin against the verified acquisition source excerpt on "+new Date().toISOString().slice(0,10)+".",
                    p_verified_source_url:(task.source && task.source.url) || null
                })
            });
            const verifyData=await verifyResponse.json().catch(function(){return null;});
            if(!verifyResponse.ok) throw new Error(verifyData && (verifyData.message || verifyData.error || verifyData.hint) ? String(verifyData.message || verifyData.error || verifyData.hint) : "Knowledge verification failed.");

            if(button){button.textContent="Indexing…";}
            const embedResponse=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({action:"embed_knowledge",knowledge_ids:[task.knowledge_draft_id]})
            });
            const embedData=await embedResponse.json().catch(function(){return null;});
            if(!embedResponse.ok) throw new Error(embedData && (embedData.message || embedData.error || embedData.hint) ? String(embedData.message || embedData.error || embedData.hint) : "Knowledge indexing failed.");

            const statusResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_knowledge?id=eq."+encodeURIComponent(task.knowledge_draft_id)+"&select=id,status,verification_status,embedding_status&limit=1",{method:"GET",headers:authHeaders()});
            const statusData=await statusResponse.json().catch(function(){return [];});
            const row=Array.isArray(statusData) ? statusData[0] : null;
            if(!row || row.verification_status!=="verified" || row.embedding_status!=="ready"){
                throw new Error("Knowledge was not fully verified and indexed; publication was blocked.");
            }

            if(button){button.textContent="Publishing…";}
            const publishResponse=await fetch(SUPABASE_URL+"/rest/v1/rpc/publish_innerme_knowledge_draft",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({p_knowledge_id:task.knowledge_draft_id,p_acquisition_task_id:id})
            });
            const publishData=await publishResponse.json().catch(function(){return null;});
            if(!publishResponse.ok) throw new Error(publishData && (publishData.message || publishData.error || publishData.hint) ? String(publishData.message || publishData.error || publishData.hint) : "Knowledge publication failed.");

            window.alert("Knowledge verified, indexed and published successfully.");
            const nextItems=await loadAcquisitionTasks();
            container.innerHTML=renderAcquisitionQueue(nextItems);
            container.__swayAcquisitionItems=nextItems;
        }catch(error){
            window.alert(error.message || "Knowledge publication failed.");
            if(button){button.disabled=false;button.textContent="Verify, index & publish";}
        }
    }

    function renderKnowledgeGapQueue(items) {
        if (!items.length) {
            return '<p class="sway-ai-ki-good">No active knowledge-acquisition candidates are waiting for review.</p>';
        }
        return items.map(function(item){
            const status=String(item.status || "candidate");
            const examples=Array.isArray(item.example_queries) ? item.example_queries.filter(Boolean).slice(0,4) : [];
            const buttons=status==="candidate"
                ? '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-gap-approve="'+esc(String(item.id || ""))+'">Approve acquisition</button>' +
                  '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-gap-dismiss="'+esc(String(item.id || ""))+'">Dismiss</button>'
                : '<span class="sway-ai-ki-gap-approved-note">Approved for source acquisition. No live knowledge was added.</span>';
            return '<article class="sway-ai-ki-gap-item">' +
                '<div class="sway-ai-ki-gap-head"><div><strong>'+esc(item.title || "Untitled knowledge gap")+'</strong><span>'+esc(item.domain || "Unclassified")+(item.jurisdiction ? " · "+esc(item.jurisdiction) : "")+'</span></div><em>'+esc(status.replace(/_/g," "))+' · P'+esc(item.priority || 50)+'</em></div>' +
                '<p class="sway-ai-ki-gap-statement">'+esc(item.gap_statement || "")+'</p>' +
                '<div class="sway-ai-ki-gap-grid"><div><span>Why needed</span><strong>'+esc(item.why_needed || "Evidence indicates this topic needs better coverage.")+'</strong></div><div><span>Acquisition target</span><strong>'+esc(item.acquisition_target || "Identify a suitable verified source.")+'</strong></div></div>' +
                '<div class="sway-ai-ki-gap-meta"><span>Evidence: '+esc(item.recommended_evidence_level || "unknown")+'</span><span>Source type: '+esc(item.recommended_source_type || "Not specified")+'</span><span>Demand signals: '+esc(item.demand_count || 1)+'</span><span>Confidence: '+esc(item.confidence || "medium")+'</span></div>' +
                (examples.length ? '<div class="sway-ai-ki-gap-examples"><span>Questions this gap should help answer</span>'+examples.map(function(ex){return '<code>'+esc(ex)+'</code>';}).join("")+'</div>' : "") +
                '<div class="sway-ai-ki-gap-actions">'+buttons+'</div></article>';
        }).join("");
    }

    async function reviewKnowledgeGap(gapId,decision,resultsElement) {
        const id=String(gapId || "").trim();
        if(!id || !["approved","dismissed"].includes(decision)) return;
        const label=decision==="approved" ? "Approve this knowledge-acquisition target?" : "Dismiss this knowledge-acquisition target?";
        if(!window.confirm(label)) return;
        const button=document.querySelector('[data-sway-ai-ki-gap-'+decision+'="'+CSS.escape(id)+'"]');
        if(button){ button.disabled=true; button.textContent=decision==="approved" ? "Approving…" : "Dismissing…"; }
        try{
            const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_knowledge_gap",{
                method:"POST",
                headers:authHeaders(),
                body:JSON.stringify({p_gap_id:id,p_decision:decision})
            });
            const data=await response.json().catch(function(){return null;});
            if(!response.ok) throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Knowledge-gap review failed.");
            const items=await loadKnowledgeGapQueue();
            resultsElement.innerHTML=renderKnowledgeGapQueue(items);
            resultsElement.__swayGapItems=items;
        }catch(error){
            if(button){button.disabled=false;button.textContent=decision==="approved" ? "Approve acquisition" : "Dismiss";}
            window.alert(error.message || "Knowledge-gap review failed.");
        }
    }

    function ensurePanel() {
        if (document.getElementById(PANEL_ID)) return;

        const morePanel = document.getElementById("sway-ai-more-panel");
        if (!morePanel) return;

        const details = document.createElement("details");
        details.id = PANEL_ID;
        details.className = "sway-ai-knowledge-intelligence-panel";
        details.innerHTML =
            '<summary>Knowledge intelligence</summary>' +
            '<div class="sway-ai-ki-controls">' +
                '<span>Checks knowledge coverage, freshness, semantic overlap, possible conflicts and retrieval evidence.</span>' +
                '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-run>Analyse knowledge health</button>' +
            '</div>' +
            '<details class="sway-ai-ki-gaps" data-sway-ai-ki-gaps-panel>' +
                '<summary>Knowledge gaps</summary>' +
                '<div class="sway-ai-ki-gaps-controls">' +
                    '<span>Finds evidence-backed topics InnerMe should acquire next. Proposals stay outside live knowledge until a verified source is acquired.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-gaps-run>Analyse knowledge gaps</button>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-gaps-refresh>Refresh gap queue</button>' +
                '</div>' +
                '<div class="sway-ai-ki-gaps-analysis"><p class="sway-ai-ki-muted">Not analysed yet.</p></div>' +
                '<div class="sway-ai-ki-gaps-results"><p class="sway-ai-ki-muted">Open this section to load acquisition candidates.</p></div>' +
            '</details>' +
            '<details class="sway-ai-ki-verification" data-sway-ai-ki-verification-panel>' +
                '<summary>Source verification</summary>' +
                '<div class="sway-ai-ki-verification-controls">' +
                    '<span>Applied or unverified knowledge stays out of retrieval until its source is checked and the record is re-indexed.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-verify-refresh>Refresh verification queue</button>' +
                '</div>' +
                '<div class="sway-ai-ki-verification-results">' +
                    '<p class="sway-ai-ki-muted">Open this section to load records waiting for verification.</p>' +
                '</div>' +
            '</details>' +
            '<div class="sway-ai-ki-results">' +
                '<p class="sway-ai-ki-muted">Not analysed yet.</p>' +
            '</div>';

        const retrievalTest = morePanel.querySelector(".sway-ai-knowledge-test");
        if (retrievalTest) {
            morePanel.insertBefore(details, retrievalTest);
        } else {
            morePanel.appendChild(details);
        }

        const button = details.querySelector("[data-sway-ai-ki-run]");
        const results = details.querySelector(".sway-ai-ki-results");

        button.addEventListener("click", async function () {
            if (button.disabled) return;

            button.disabled = true;
            button.textContent = "Analysing…";
            results.innerHTML = '<p class="sway-ai-ki-muted">Checking the knowledge base…</p>';

            try {
                const report = await analyse();
                results.innerHTML = render(report);
            } catch (error) {
                results.innerHTML =
                    '<p class="sway-ai-ki-error">' +
                        esc(error.message || "Analysis failed.") +
                    '</p>';
            } finally {
                button.disabled = false;
                button.textContent = "Analyse knowledge health";
            }
        });

        const gapsPanel = details.querySelector("[data-sway-ai-ki-gaps-panel]");
        const gapsAnalysis = details.querySelector(".sway-ai-ki-gaps-analysis");
        const gapsResults = details.querySelector(".sway-ai-ki-gaps-results");
        const gapsRun = details.querySelector("[data-sway-ai-ki-gaps-run]");
        const gapsRefresh = details.querySelector("[data-sway-ai-ki-gaps-refresh]");

        async function refreshKnowledgeGapQueue() {
            gapsResults.innerHTML='<p class="sway-ai-ki-muted">Loading knowledge-acquisition candidates…</p>';
            try {
                const items=await loadKnowledgeGapQueue();
                gapsResults.innerHTML=renderKnowledgeGapQueue(items);
                gapsResults.__swayGapItems=items;
            } catch(error) {
                gapsResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message || "Knowledge-gap queue failed to load.")+'</p>';
                gapsResults.__swayGapItems=[];
            }
        }

        if(gapsPanel){
            gapsPanel.addEventListener("toggle",function(){
                if(gapsPanel.open) refreshKnowledgeGapQueue();
            });
        }

        if(gapsRun){
            gapsRun.addEventListener("click",async function(event){
                event.preventDefault();
                event.stopPropagation();
                if(gapsRun.disabled) return;
                gapsRun.disabled=true;
                gapsRun.textContent="Analysing…";
                gapsAnalysis.innerHTML='<p class="sway-ai-ki-muted">Checking corrections, weak retrievals and current coverage…</p>';
                try{
                    const report=await analyseKnowledgeGaps();
                    const signals=report && report.signals ? report.signals : {};
                    const status=String(report && report.status || "unknown");
                    gapsAnalysis.innerHTML='<div class="sway-ai-ki-gap-summary">' +
                        '<div><span>Engine status</span><strong>'+esc(status.replace(/_/g," "))+'</strong></div>' +
                        '<div><span>Corrections</span><strong>'+esc(signals.corrections || 0)+'</strong></div>' +
                        '<div><span>Weak retrievals</span><strong>'+esc(signals.weak_retrievals || 0)+'</strong></div>' +
                        '<div><span>Actionable evidence</span><strong>'+esc(signals.actionable_evidence_records || 0)+'</strong></div>' +
                    '</div><p class="'+(status==="insufficient_evidence" ? "sway-ai-ki-muted" : "sway-ai-ki-good")+'">'+
                        esc(report.message || (report.new_candidates ? String(report.new_candidates)+" new acquisition target"+(report.new_candidates===1 ? "" : "s")+" generated." : "No new acquisition targets were generated."))+
                    '</p>';
                    await refreshKnowledgeGapQueue();
                }catch(error){
                    gapsAnalysis.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message || "Knowledge-gap analysis failed.")+'</p>';
                }finally{
                    gapsRun.disabled=false;
                    gapsRun.textContent="Analyse knowledge gaps";
                }
            });
        }

        if(gapsRefresh){
            gapsRefresh.addEventListener("click",function(event){
                event.preventDefault();
                event.stopPropagation();
                refreshKnowledgeGapQueue();
            });
        }

        gapsResults.addEventListener("click",function(event){
            const approveTarget=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-gap-approve]") : null;
            const dismissTarget=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-gap-dismiss]") : null;
            const target=approveTarget || dismissTarget;
            if(!target) return;
            event.preventDefault();
            event.stopPropagation();
            reviewKnowledgeGap(
                target.dataset.swayAiKiGapApprove || target.dataset.swayAiKiGapDismiss || "",
                approveTarget ? "approved" : "dismissed",
                gapsResults
            );
        });

        const verificationPanel = details.querySelector("[data-sway-ai-ki-verification-panel]");
        const verificationResults = details.querySelector(".sway-ai-ki-verification-results");
        const verificationRefresh = details.querySelector("[data-sway-ai-ki-verify-refresh]");

        async function refreshVerificationQueue() {
            verificationResults.innerHTML =
                '<p class="sway-ai-ki-muted">Loading records waiting for verification…</p>';

            try {
                const items = await loadVerificationQueue();
                verificationResults.innerHTML = renderVerificationQueue(items);
                verificationResults.__swayVerificationItems = items;
            } catch (error) {
                verificationResults.innerHTML =
                    '<p class="sway-ai-ki-error">' +
                        esc(error.message || "Verification queue failed to load.") +
                    '</p>';
                verificationResults.__swayVerificationItems = [];
            }
        }

        if (verificationPanel) {
            verificationPanel.addEventListener("toggle", function () {
                if (verificationPanel.open) {
                    refreshVerificationQueue();
                }
            });
        }

        if (verificationRefresh) {
            verificationRefresh.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                refreshVerificationQueue();
            });
        }

        verificationResults.addEventListener("click", function (event) {
            const target =
                event.target &&
                event.target.closest
                    ? event.target.closest("[data-sway-ai-ki-verify]")
                    : null;

            if (!target) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const items =
                Array.isArray(verificationResults.__swayVerificationItems)
                    ? verificationResults.__swayVerificationItems
                    : [];

            verifyAndReindex(
                target.dataset.swayAiKiVerify || "",
                items
            );
        });
    }

    const style = document.createElement("style");
    style.textContent =
        ".sway-ai-knowledge-intelligence-panel{width:100%;margin:2px 0}" +
        ".sway-ai-knowledge-intelligence-panel>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-knowledge-intelligence-panel>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-knowledge-intelligence-panel>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-knowledge-intelligence-panel[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-metric{padding:8px;border:1px solid rgba(1,82,244,.1);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-metric span{display:block;font-size:8px;opacity:.58}" +
        ".sway-ai-ki-metric strong{display:block;margin-top:3px;font-size:12px}" +
        ".sway-ai-ki-section{display:grid;gap:5px;padding:9px;border:1px solid rgba(1,82,244,.08);border-radius:10px}" +
        ".sway-ai-ki-section>strong{font-size:11px}" +
        ".sway-ai-ki-section>span{font-size:9px;opacity:.55}" +
        ".sway-ai-ki-list{display:grid;gap:4px}" +
        ".sway-ai-ki-row{display:flex;justify-content:space-between;gap:8px;font-size:9px}" +
        ".sway-ai-ki-muted,.sway-ai-ki-good,.sway-ai-ki-error,.sway-ai-ki-signals{margin:0;font-size:10px;line-height:1.45}" +
        ".sway-ai-ki-good{color:#157347}" +
        ".sway-ai-ki-error{color:#b42318}" +
        ".sway-ai-ki-section ul{margin:0;padding-left:17px;display:grid;gap:4px}" +
        ".sway-ai-ki-section li{font-size:9px;line-height:1.4}" +
        ".sway-ai-ki-foot{font-size:8px;line-height:1.4;opacity:.52}" +
        "body.sway-dark-mode .sway-ai-ki-metric,body.sway-dark-mode .sway-ai-ki-section{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-good{color:#8bd3a8}" +
        "body.sway-dark-mode .sway-ai-ki-error{color:#ffb4ab}" +
        ".sway-ai-ki-verification{width:100%;margin:4px 0}" +
        ".sway-ai-ki-verification>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-verification>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-verification>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-verification[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-verification-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-verification-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-verification-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-verification-item{display:grid;gap:8px;padding:10px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-verification-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-verification-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-verification-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-verification-head span{font-size:9px;opacity:.58}" +
        ".sway-ai-ki-verification-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-verification-statement{margin:0;font-size:10px;line-height:1.5;white-space:pre-wrap}" +
        ".sway-ai-ki-verification-source{display:grid;gap:2px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-verification-source strong{font-size:10px}" +
        ".sway-ai-ki-verification-source span,.sway-ai-ki-verification-source a{font-size:9px;overflow-wrap:anywhere}" +
        ".sway-ai-ki-verification-source a{color:#0152F4;text-decoration:none;font-weight:700}" +
        ".sway-ai-ki-verification-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:8px;line-height:1.35;opacity:.62}" +
        ".sway-ai-ki-verification-actions{display:flex;justify-content:flex-end;padding-top:2px}" +
        "body.sway-dark-mode .sway-ai-ki-verification-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-verification-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-verification-source{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-verification-source a{color:#9FD5FF}" +
        ".sway-ai-ki-gaps{width:100%;margin:4px 0}" +
        ".sway-ai-ki-gaps>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-gaps>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-gaps>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-gaps[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-gaps-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-gaps-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-gaps-analysis,.sway-ai-ki-gaps-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-gap-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-gap-summary>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-gap-summary span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-gap-summary strong{font-size:11px}" +
        ".sway-ai-ki-gap-item{display:grid;gap:8px;padding:10px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-gap-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-gap-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-gap-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-gap-head span{font-size:9px;opacity:.58}" +
        ".sway-ai-ki-gap-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-gap-statement{margin:0;font-size:10px;line-height:1.5;white-space:pre-wrap}" +
        ".sway-ai-ki-gap-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-gap-grid>div{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-gap-grid span,.sway-ai-ki-gap-examples>span{font-size:8px;opacity:.55}" +
        ".sway-ai-ki-gap-grid strong{font-size:9px;font-weight:600;line-height:1.4}" +
        ".sway-ai-ki-gap-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:8px;line-height:1.35;opacity:.62}" +
        ".sway-ai-ki-gap-examples{display:grid;gap:5px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-gap-examples code{font-size:8px;line-height:1.4;padding:5px 6px;border-radius:7px;background:rgba(1,82,244,.045);white-space:normal;overflow-wrap:anywhere}" +
        ".sway-ai-ki-gap-actions{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;padding-top:2px}" +
        ".sway-ai-ki-gap-approved-note{font-size:8px;opacity:.65;line-height:1.4}" +
        "body.sway-dark-mode .sway-ai-ki-gap-summary>div,body.sway-dark-mode .sway-ai-ki-gap-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-gap-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-gap-grid>div,body.sway-dark-mode .sway-ai-ki-gap-examples{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-gap-examples code{background:rgba(119,193,252,.055)}" +
        "@media(max-width:680px){.sway-ai-ki-gap-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-gap-head{display:grid;gap:6px}.sway-ai-ki-gap-head em{width:fit-content}.sway-ai-ki-gap-grid{grid-template-columns:1fr}}";
        "@media(max-width:680px){.sway-ai-ki-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-verification-head{display:grid;gap:6px}.sway-ai-ki-verification-head em{width:fit-content}}";
    document.head.appendChild(style);

    const observer = new MutationObserver(function () {
        if (document.getElementById("sway-ai-more-panel")) ensurePanel();
    });

    observer.observe(document.body, {childList: true, subtree: true});
    ensurePanel();
})();
