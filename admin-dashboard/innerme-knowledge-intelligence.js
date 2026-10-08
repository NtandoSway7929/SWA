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
            const safeHttpUrl = /^https?:\/\//i.test(sourceUrl);
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
            '<details class="sway-ai-ki-decisions" data-sway-ai-ki-decisions-panel>' +
                '<summary>Decision intelligence</summary>' +
                '<div class="sway-ai-ki-decisions-controls">' +
                    '<span>Ranks the most useful business decisions from current workspace evidence and governed knowledge. Recommendations remain candidates until you approve them.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-decisions-run>Find decisions</button>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-decisions-refresh>Refresh candidates</button>' +
                '</div>' +
                '<div class="sway-ai-ki-decisions-summary"><p class="sway-ai-ki-muted">No decision analysis run yet.</p></div>' +
                '<div class="sway-ai-ki-decisions-results"><p class="sway-ai-ki-muted">Open this section to load decision candidates.</p></div>' +
            '</details>' +

            '<details class="sway-ai-ki-execution" data-sway-ai-ki-execution-panel>' +
                '<summary>Execution intelligence</summary>' +
                '<div class="sway-ai-ki-execution-controls">' +
                    '<span>Turns approved InnerMe decisions into evidence-linked draft execution plans. Plans require explicit approval, and controlled actions require a separate approval and execution gate.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-execution-refresh>Refresh approved decisions</button>' +
                '</div>' +
                '<div class="sway-ai-ki-execution-summary"><p class="sway-ai-ki-muted">No execution plans loaded.</p></div>' +
                '<div class="sway-ai-ki-execution-results"><p class="sway-ai-ki-muted">Open this section to load approved decisions.</p></div>' +
            '</details>' +
            '<details class="sway-ai-ki-experiments" data-sway-ai-ki-experiments-panel>' +
                '<summary>Experimentation &amp; optimization</summary>' +
                '<div class="sway-ai-ki-experiments-controls">' +
                    '<span>Design, approve and evaluate controlled experiments. InnerMe does not automatically start experiments or change business decisions.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-experiments-refresh>Refresh experiments</button>' +
                '</div>' +
                '<div class="sway-ai-ki-experiments-summary"><p class="sway-ai-ki-muted">No experiments loaded.</p></div>' +
                '<div class="sway-ai-ki-experiments-results"><p class="sway-ai-ki-muted">Open this section to load experiments.</p></div>' +
            '</details>' +
            '<details class="sway-ai-ki-outcomes" data-sway-ai-ki-outcomes-panel>' +
                '<summary>Outcome intelligence</summary>' +
                '<div class="sway-ai-ki-outcomes-controls">' +
                    '<span>Measures what happened after controlled InnerMe actions. Execution is verified separately from business success, and final outcome judgements require explicit admin review.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-outcomes-refresh>Refresh outcomes</button>' +
                '</div>' +
                '<div class="sway-ai-ki-outcomes-summary"><p class="sway-ai-ki-muted">No outcome reviews loaded.</p></div>' +
                '<div class="sway-ai-ki-outcomes-results"><p class="sway-ai-ki-muted">Open this section to load outcome reviews.</p></div>' +
            '</details>' +
            '<details class="sway-ai-ki-evaluation" data-sway-ai-ki-evaluation-panel>' +
                '<summary>Evaluation &amp; benchmarking</summary>' +
                '<div class="sway-ai-ki-evaluation-controls">' +
                    '<span>Runs fixed InnerMe test cases against verified knowledge and records retrieval recall, answer quality, grounding, safety and pass/fail outcomes.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-eval-run>Run benchmark</button>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-eval-refresh>Refresh results</button>' +
                '</div>' +
                '<div class="sway-ai-ki-evaluation-summary"><p class="sway-ai-ki-muted">No benchmark results loaded.</p></div>' +
                '<div class="sway-ai-ki-evaluation-results"><p class="sway-ai-ki-muted">Open this section to load benchmark results.</p></div>' +
            '</details>' +
            '<details class="sway-ai-ki-acquisition" data-sway-ai-ki-acquisition-panel>' +
                '<summary>Acquisition tasks</summary>' +
                '<div class="sway-ai-ki-acquisition-controls">' +
                    '<span>Turns approved knowledge gaps into source-backed draft records. Every task stays gated by source verification, knowledge verification, indexing and explicit publication.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-acq-refresh>Refresh acquisition tasks</button>' +
                '</div>' +
                '<div class="sway-ai-ki-acquisition-results"><p class="sway-ai-ki-muted">Open this section to load acquisition tasks.</p></div>' +
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

        const decisionsPanel=details.querySelector("[data-sway-ai-ki-decisions-panel]");
        const decisionsRun=details.querySelector("[data-sway-ai-ki-decisions-run]");
        const decisionsRefresh=details.querySelector("[data-sway-ai-ki-decisions-refresh]");
        const decisionsSummary=details.querySelector(".sway-ai-ki-decisions-summary");
        const decisionsResults=details.querySelector(".sway-ai-ki-decisions-results");

        async function loadDecisionCandidates() {
            const response=await fetch(
                SUPABASE_URL+"/rest/v1/innerme_decision_candidates?select=id,title,decision,context,rationale,evidence,expected_impact,effort,urgency,confidence,recommended_next_action,priority,status,source_conversation_id,created_at,updated_at&status=eq.candidate&order=priority.desc,created_at.desc&limit=30",
                {method:"GET",headers:authHeaders()}
            );
            const data=await response.json().catch(function(){return [];});
            if(!response.ok){
                throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Unable to load decision candidates.");
            }
            return Array.isArray(data)?data:[];
        }

        function renderDecisionCandidates(items) {
            if(!items.length){
                return '<p class="sway-ai-ki-muted">No decision candidates are waiting for review.</p>';
            }
            return items.map(function(item){
                const evidence=Array.isArray(item.evidence)?item.evidence:[];
                const evidenceHtml=evidence.slice(0,6).map(function(ref){
                    return '<span>'+esc(ref.type||"record")+' · '+esc(ref.id||"")+' · '+esc(ref.why||"")+'</span>';
                }).join("");
                return '<article class="sway-ai-ki-decision-item">' +
                    '<div class="sway-ai-ki-decision-head"><div><strong>'+esc(item.title||"Decision candidate")+'</strong><span>'+esc(item.urgency||"normal")+' · P'+esc(item.priority||50)+' · '+esc(item.confidence||"medium")+'</span></div><em>'+esc(item.status||"candidate")+'</em></div>' +
                    '<p class="sway-ai-ki-decision-main">'+esc(item.decision||"")+'</p>' +
                    '<div class="sway-ai-ki-decision-grid"><div><span>Context</span><strong>'+esc(item.context||"Current workspace evidence supports review of this decision.")+'</strong></div><div><span>Rationale</span><strong>'+esc(item.rationale||"")+'</strong></div><div><span>Expected impact</span><strong>'+esc(item.expected_impact||"Not specified")+'</strong></div><div><span>Next action</span><strong>'+esc(item.recommended_next_action||"Review the evidence and decide.")+'</strong></div></div>' +
                    '<div class="sway-ai-ki-decision-meta"><span>Effort: '+esc(item.effort||"medium")+'</span><span>Urgency: '+esc(item.urgency||"normal")+'</span><span>Confidence: '+esc(item.confidence||"medium")+'</span></div>' +
                    (evidenceHtml ? '<div class="sway-ai-ki-decision-evidence"><span>Evidence</span>'+evidenceHtml+'</div>' : "") +
                    '<div class="sway-ai-ki-gap-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-decision-approve="'+esc(String(item.id||""))+'">Approve decision</button><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-decision-dismiss="'+esc(String(item.id||""))+'">Dismiss</button></div>' +
                '</article>';
            }).join("");
        }

        async function refreshDecisionCandidates() {
            decisionsResults.innerHTML='<p class="sway-ai-ki-muted">Loading decision candidates…</p>';
            try{
                const items=await loadDecisionCandidates();
                decisionsResults.innerHTML=renderDecisionCandidates(items);
                decisionsResults.__swayDecisionItems=items;
            }catch(error){
                decisionsResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Decision candidates failed to load.")+'</p>';
                decisionsResults.__swayDecisionItems=[];
            }
        }

        if(decisionsPanel){
            decisionsPanel.addEventListener("toggle",function(){
                if(decisionsPanel.open) refreshDecisionCandidates();
            });
        }

        if(decisionsRefresh){
            decisionsRefresh.addEventListener("click",function(event){
                event.preventDefault(); event.stopPropagation();
                refreshDecisionCandidates();
            });
        }

        if(decisionsRun){
            decisionsRun.addEventListener("click",async function(event){
                event.preventDefault(); event.stopPropagation();
                if(decisionsRun.disabled) return;
                decisionsRun.disabled=true;
                decisionsRun.textContent="Analysing…";
                decisionsSummary.innerHTML='<p class="sway-ai-ki-muted">Combining current workspace evidence with verified knowledge…</p>';
                try{
                    const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                        method:"POST",headers:authHeaders(),
                        body:JSON.stringify({action:"decision_intelligence",message:"What are the most important business decisions Swayphics should consider right now?"})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Decision analysis failed.");
                    decisionsSummary.innerHTML='<div class="sway-ai-ki-decision-summary-grid"><div><span>New candidates</span><strong>'+esc(data.new_candidates||0)+'</strong></div><div><span>Provider</span><strong>'+esc(data.provider_model||"unknown")+'</strong></div><div><span>Approval</span><strong>Required</strong></div><div><span>Live decisions changed</span><strong>No</strong></div></div>';
                    await refreshDecisionCandidates();
                }catch(error){
                    decisionsSummary.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Decision analysis failed.")+'</p>';
                }finally{
                    decisionsRun.disabled=false;
                    decisionsRun.textContent="Find decisions";
                }
            });
        }

        decisionsResults.addEventListener("click",async function(event){
            const approve=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-decision-approve]") : null;
            const dismiss=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-decision-dismiss]") : null;
            const target=approve||dismiss;
            if(!target) return;
            event.preventDefault(); event.stopPropagation();

            const id=target.dataset.swayAiKiDecisionApprove || target.dataset.swayAiKiDecisionDismiss || "";
            const decision=approve ? "approved" : "dismissed";
            if(!id || !window.confirm(approve ? "Approve this decision into InnerMe's active business brain?" : "Dismiss this decision candidate?")) return;

            target.disabled=true;
            target.textContent=approve ? "Approving…" : "Dismissing…";
            try{
                const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_decision_candidate",{
                    method:"POST",
                    headers:authHeaders(),
                    body:JSON.stringify({p_candidate_id:id,p_decision:decision})
                });
                const data=await response.json().catch(function(){return null;});
                if(!response.ok) throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Decision review failed.");
                await refreshDecisionCandidates();
                await refreshExecutionPlans(false);
                window.alert(approve ? "Decision approved and added to InnerMe's active business brain." : "Decision candidate dismissed.");
            }catch(error){
                target.disabled=false;
                target.textContent=approve ? "Approve decision" : "Dismiss";
                window.alert(error.message||"Decision review failed.");
            }
        });


        const executionPanel=details.querySelector("[data-sway-ai-ki-execution-panel]");
        const executionRefresh=details.querySelector("[data-sway-ai-ki-execution-refresh]");
        const executionSummary=details.querySelector(".sway-ai-ki-execution-summary");
        const executionResults=details.querySelector(".sway-ai-ki-execution-results");

        async function loadExecutionPlans() {
            const decisionsResponse=await fetch(
                SUPABASE_URL+
                    "/rest/v1/innerme_decisions?select=id,title,decision,context,rationale,evidence,expected_impact,effort,urgency,confidence,recommended_next_action,priority,status,source_conversation_id,created_at,updated_at&status=eq.active&order=priority.desc,created_at.desc&limit=30",
                {method:"GET",headers:authHeaders()}
            );
            const decisions=await decisionsResponse.json().catch(function(){return [];});
            if(!decisionsResponse.ok){
                throw new Error(
                    decisions && (decisions.message || decisions.error || decisions.hint)
                        ? String(decisions.message || decisions.error || decisions.hint)
                        : "Unable to load active InnerMe decisions."
                );
            }

            const plansResponse=await fetch(
                SUPABASE_URL+
                    "/rest/v1/innerme_execution_plans?select=id,plan_key,decision_id,title,objective,rationale,evidence,success_metric,completion_criteria,expected_outcome,duration_days,target_date,effort,urgency,confidence,risk,status,source_conversation_id,approved_by,approved_at,created_at,updated_at&order=created_at.desc&limit=50",
                {method:"GET",headers:authHeaders()}
            );
            const plans=await plansResponse.json().catch(function(){return [];});
            if(!plansResponse.ok){
                throw new Error(
                    plans && (plans.message || plans.error || plans.hint)
                        ? String(plans.message || plans.error || plans.hint)
                        : "Unable to load InnerMe execution plans."
                );
            }

            const allPlans=Array.isArray(plans)?plans:[];
            const planIds=allPlans.map(function(item){return String(item && item.id || "").trim();}).filter(Boolean);
            let steps=[];

            if(planIds.length){
                const stepsResponse=await fetch(
                    SUPABASE_URL+
                        "/rest/v1/innerme_execution_steps?select=id,plan_id,step_order,title,action,purpose,owner_role,due_offset_days,depends_on_step_order,success_signal,verification_method,risk_level,status,linked_task_id,notes,created_at,updated_at&plan_id=in.("+planIds.join(",")+")&order=step_order.asc&limit=400",
                    {method:"GET",headers:authHeaders()}
                );
                const stepsData=await stepsResponse.json().catch(function(){return [];});
                if(!stepsResponse.ok){
                    throw new Error(
                        stepsData && (stepsData.message || stepsData.error || stepsData.hint)
                            ? String(stepsData.message || stepsData.error || stepsData.hint)
                            : "Unable to load execution plan steps."
                    );
                }
                steps=Array.isArray(stepsData)?stepsData:[];
            }

            const stepsByPlan=new Map();
            steps.forEach(function(step){
                const key=String(step.plan_id||"");
                if(!stepsByPlan.has(key)) stepsByPlan.set(key,[]);
                stepsByPlan.get(key).push(step);
            });

            let actionProposals=[];
            if(planIds.length){
                const actionResponse=await fetch(
                    SUPABASE_URL+
                        "/rest/v1/innerme_action_proposals?select=id,proposal_key,plan_id,step_id,action_type,title,purpose,payload,evidence,requires_confirmation,status,approved_at,executed_by,executed_at,execution_result,error_message,created_at,updated_at&plan_id=in.("+planIds.join(",")+")&order=created_at.desc&limit=200",
                    {method:"GET",headers:authHeaders()}
                );
                const actionData=await actionResponse.json().catch(function(){return [];});
                if(!actionResponse.ok){
                    throw new Error(
                        actionData && (actionData.message || actionData.error || actionData.hint)
                            ? String(actionData.message || actionData.error || actionData.hint)
                            : "Unable to load controlled action proposals."
                    );
                }
                actionProposals=Array.isArray(actionData)?actionData:[];
            }

            return {
                decisions:Array.isArray(decisions)?decisions:[],
                plans:allPlans,
                stepsByPlan:stepsByPlan,
                actionProposals:actionProposals
            };
        }

        function renderExecutionPlans(data){
            const decisions=Array.isArray(data && data.decisions)?data.decisions:[];
            const plans=Array.isArray(data && data.plans)?data.plans:[];
            const stepsByPlan=data && data.stepsByPlan instanceof Map ? data.stepsByPlan : new Map();

            if(!decisions.length){
                return '<p class="sway-ai-ki-muted">No active InnerMe decisions are available. Approve a decision candidate first.</p>';
            }

            return decisions.map(function(decision){
                const plan=plans.find(function(item){
                    return String(item && item.decision_id || "")===String(decision.id||"") &&
                        ["draft","approved","active"].includes(String(item && item.status || ""));
                }) || null;

                const steps=plan ? (stepsByPlan.get(String(plan.id||"")) || []) : [];
                const status=plan ? String(plan.status||"draft") : "not planned";
                const statusClass=status==="approved" ? "approved" : status==="active" ? "active" : status==="draft" ? "draft" : "none";

                let planHtml="";
                if(!plan){
                    planHtml='<div class="sway-ai-ki-execution-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-execution-build="'+esc(String(decision.id||""))+'">Build execution plan</button></div>';
                }else{
                    const criteria=Array.isArray(plan.completion_criteria)?plan.completion_criteria:[];
                    const evidence=Array.isArray(plan.evidence)?plan.evidence:[];
                    const stepsHtml=steps.map(function(step){
                        return '<div class="sway-ai-ki-execution-step">' +
                            '<div class="sway-ai-ki-execution-step-head"><strong>'+esc(String(step.step_order||""))+'. '+esc(step.title||"Execution step")+'</strong><span>'+esc(step.status||"planned")+'</span></div>' +
                            '<p>'+esc(step.action||"")+'</p>' +
                            '<div class="sway-ai-ki-execution-step-meta"><span>Owner: '+esc(step.owner_role||"Swayphics admin")+'</span><span>Due: '+(step.due_offset_days==null?"Not specified":"Day "+esc(step.due_offset_days))+'</span><span>Risk: '+esc(step.risk_level||"low")+'</span>' +
                            (step.depends_on_step_order ? '<span>After step '+esc(step.depends_on_step_order)+'</span>' : '') +
                            '</div>' +
                            (step.success_signal ? '<div class="sway-ai-ki-execution-step-detail"><span>Success signal</span><strong>'+esc(step.success_signal)+'</strong></div>' : '') +
                            (step.verification_method ? '<div class="sway-ai-ki-execution-step-detail"><span>Verification</span><strong>'+esc(step.verification_method)+'</strong></div>' : '') +
                        '</div>';
                    }).join("");

                    const criteriaHtml=criteria.length
                        ? '<div class="sway-ai-ki-execution-detail"><span>Completion criteria</span><ul>'+criteria.map(function(item){return '<li>'+esc(item)+'</li>';}).join("")+'</ul></div>'
                        : "";
                    const evidenceHtml=evidence.length
                        ? '<div class="sway-ai-ki-execution-detail"><span>Plan evidence</span><div class="sway-ai-ki-execution-evidence">'+evidence.slice(0,8).map(function(ref){return '<span>'+esc(ref.source||"workspace")+' · '+esc(ref.type||"record")+' · '+esc(ref.id||"")+' · '+esc(ref.why||"")+'</span>';}).join("")+'</div></div>'
                        : "";

                    const planActions=(Array.isArray(data && data.actionProposals)?data.actionProposals:[]).filter(function(item){
                        return String(item && item.plan_id || "")===String(plan.id||"");
                    });

                    const proposalStatusLabel=function(value){
                        return String(value||"proposed").replace(/_/g," ");
                    };

                    const renderActionPayload=function(item){
                        const payload=item && item.payload && typeof item.payload==="object" ? item.payload : {};
                        if(item.action_type==="send_email"){
                            return '<div class="sway-ai-ki-execution-action-payload">' +
                                '<span>Recipient</span><strong>'+esc(payload.contact_type||"contact")+' · '+esc(payload.contact_id||"")+'</strong>' +
                                '<span>Subject</span><strong>'+esc(payload.subject||"")+'</strong>' +
                                '<span>Message</span><p>'+esc(payload.message||"")+'</p>' +
                            '</div>';
                        }
                        return '<div class="sway-ai-ki-execution-action-payload">' +
                            '<span>Task</span><strong>'+esc(payload.title||item.title||"")+'</strong>' +
                            '<span>Priority</span><strong>'+esc(payload.priority||"medium")+'</strong>' +
                            '<span>Due</span><strong>'+esc(payload.due_offset_days==null?"Not specified":"Day "+payload.due_offset_days)+'</strong>' +
                            (payload.client_id ? '<span>Client</span><strong>'+esc(payload.client_id)+'</strong>' : "") +
                            (payload.project_id ? '<span>Project</span><strong>'+esc(payload.project_id)+'</strong>' : "") +
                            (payload.lead_id ? '<span>Lead</span><strong>'+esc(payload.lead_id)+'</strong>' : "") +
                            '<span>Description</span><p>'+esc(payload.description||"")+'</p>' +
                        '</div>';
                    };

                    const actionsHtml=planActions.length
                        ? '<div class="sway-ai-ki-execution-detail"><span>Controlled actions</span><div class="sway-ai-ki-execution-actions-list">'+
                            planActions.map(function(item){
                                const actionStatus=String(item.status||"proposed");
                                let actionButtons="";
                                if(actionStatus==="proposed"){
                                    actionButtons='<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-action-approve="'+esc(String(item.id||""))+'">Approve action</button><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-action-reject="'+esc(String(item.id||""))+'">Reject</button>';
                                }else if(actionStatus==="approved"){
                                    actionButtons='<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-action-execute="'+esc(String(item.id||""))+'">Execute action</button>';
                                }
                                return '<article class="sway-ai-ki-execution-action">' +
                                    '<div class="sway-ai-ki-execution-action-head"><div><strong>'+esc(item.title||"Controlled action")+'</strong><span>'+esc(item.action_type||"action")+' · '+esc(proposalStatusLabel(actionStatus))+'</span></div><em>'+esc(proposalStatusLabel(actionStatus))+'</em></div>' +
                                    (item.purpose ? '<p>'+esc(item.purpose)+'</p>' : "") +
                                    renderActionPayload(item) +
                                    (item.error_message ? '<div class="sway-ai-ki-execution-action-error">'+esc(item.error_message)+'</div>' : "") +
                                    (item.executed_at ? '<div class="sway-ai-ki-execution-action-result">Executed '+esc(new Date(item.executed_at).toLocaleString())+'</div>' : "") +
                                    '<div class="sway-ai-ki-execution-actions">'+actionButtons+'</div>' +
                                '</article>';
                            }).join("")+
                        '</div>'
                        : (status==="approved" || status==="active"
                            ? '<div class="sway-ai-ki-execution-detail"><span>Controlled actions</span><div class="sway-ai-ki-execution-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-action-prepare="'+esc(String(plan.id||""))+'">Prepare controlled actions</button></div><strong>No action proposals prepared yet.</strong></div>'
                            : "");

                    const reviewActions=status==="draft"
                        ? '<div class="sway-ai-ki-execution-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-execution-approve="'+esc(String(plan.id||""))+'">Approve plan</button><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-execution-cancel="'+esc(String(plan.id||""))+'">Cancel draft</button></div>'
                        : '<div class="sway-ai-ki-execution-note">'+(status==="approved" ? "Approved. Controlled actions still require individual approval and explicit execution." : "Execution plan is active. Each controlled action remains auditable and separately gated.")+'</div>';

                    planHtml=
                        '<div class="sway-ai-ki-execution-plan">' +
                            '<div class="sway-ai-ki-execution-plan-head"><div><strong>'+esc(plan.title||"Execution plan")+'</strong><span>'+esc(status)+'</span></div><em class="sway-ai-ki-execution-badge sway-ai-ki-execution-'+statusClass+'">'+esc(status)+'</em></div>' +
                            '<div class="sway-ai-ki-execution-grid"><div><span>Objective</span><strong>'+esc(plan.objective||"")+'</strong></div><div><span>Success metric</span><strong>'+esc(plan.success_metric||"Not specified")+'</strong></div><div><span>Expected outcome</span><strong>'+esc(plan.expected_outcome||"Not specified")+'</strong></div><div><span>Duration</span><strong>'+esc(plan.duration_days==null?"Not specified":String(plan.duration_days)+" days")+'</strong></div></div>' +
                            (plan.rationale ? '<div class="sway-ai-ki-execution-detail"><span>Rationale</span><strong>'+esc(plan.rationale)+'</strong></div>' : '') +
                            (plan.risk ? '<div class="sway-ai-ki-execution-detail"><span>Risk</span><strong>'+esc(plan.risk)+'</strong></div>' : '') +
                            criteriaHtml +
                            '<div class="sway-ai-ki-execution-detail"><span>Steps</span><div class="sway-ai-ki-execution-steps">'+(stepsHtml || '<p class="sway-ai-ki-muted">No steps recorded.</p>')+'</div></div>' +
                            evidenceHtml +
                            actionsHtml +
                            reviewActions +
                        '</div>';
                }

                return '<article class="sway-ai-ki-execution-item">' +
                    '<div class="sway-ai-ki-execution-head"><div><strong>'+esc(decision.title||"Active decision")+'</strong><span>'+esc(decision.urgency||"normal")+' · P'+esc(decision.priority||50)+' · '+esc(decision.confidence||"medium")+'</span></div><em>'+esc(status)+'</em></div>' +
                    '<p class="sway-ai-ki-execution-decision">'+esc(decision.decision||"")+'</p>' +
                    '<div class="sway-ai-ki-execution-decision-meta"><span>Next action: '+esc(decision.recommended_next_action||"Review the approved decision.")+'</span><span>Effort: '+esc(decision.effort||"medium")+'</span></div>' +
                    planHtml +
                '</article>';
            }).join("");
        }

        async function refreshExecutionPlans(showLoading=true){
            if(showLoading) executionResults.innerHTML='<p class="sway-ai-ki-muted">Loading active decisions and execution plans…</p>';
            try{
                const data=await loadExecutionPlans();
                const planCount=data.plans.filter(function(item){return ["draft","approved","active"].includes(String(item && item.status||""));}).length;
                const actionCount=data.actionProposals.filter(function(item){return ["proposed","approved","executing"].includes(String(item && item.status||""));}).length;
                executionSummary.innerHTML='<div class="sway-ai-ki-execution-summary-grid"><div><span>Active decisions</span><strong>'+esc(data.decisions.length)+'</strong></div><div><span>Open plans</span><strong>'+esc(planCount)+'</strong></div><div><span>Pending actions</span><strong>'+esc(actionCount)+'</strong></div><div><span>External execution</span><strong>Explicit only</strong></div></div>';
                executionResults.innerHTML=renderExecutionPlans(data);
                executionResults.__swayExecutionData=data;
                return data;
            }catch(error){
                executionSummary.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Execution intelligence failed to load.")+'</p>';
                executionResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Execution intelligence failed to load.")+'</p>';
                executionResults.__swayExecutionData=null;
                return null;
            }
        }

        if(executionPanel){
            executionPanel.addEventListener("toggle",function(){
                if(executionPanel.open) refreshExecutionPlans();
            });
        }

        if(executionRefresh){
            executionRefresh.addEventListener("click",function(event){
                event.preventDefault(); event.stopPropagation();
                refreshExecutionPlans();
            });
        }

        executionResults.addEventListener("click",async function(event){
            const build=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-execution-build]") : null;
            const approve=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-execution-approve]") : null;
            const cancel=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-execution-cancel]") : null;
            const target=build||approve||cancel;
            if(!target) return;
            event.preventDefault(); event.stopPropagation();

            const prepare=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-action-prepare]") : null;
            const actionApprove=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-action-approve]") : null;
            const actionReject=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-action-reject]") : null;
            const actionExecute=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-action-execute]") : null;

            if(prepare){
                const targetPlanId=String(prepare.dataset.swayAiKiActionPrepare||"").trim();
                if(!targetPlanId || !window.confirm("Prepare controlled action proposals for this approved plan? No action will be executed.")) return;
                prepare.disabled=true;
                prepare.textContent="Preparing…";
                try{
                    const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                        method:"POST",
                        headers:authHeaders(),
                        body:JSON.stringify({action:"propose_execution_actions",plan_id:targetPlanId})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok){
                        throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Controlled action proposal generation failed.");
                    }
                    await refreshExecutionPlans(false);
                    window.alert(String(data.new_proposals||0)+" controlled action proposal(s) prepared. Review each one before approval.");
                }catch(error){
                    prepare.disabled=false;
                    prepare.textContent="Prepare controlled actions";
                    window.alert(error.message||"Controlled action proposal generation failed.");
                }
                return;
            }

            if(actionApprove || actionReject){
                const proposalId=String(
                    (actionApprove && actionApprove.dataset.swayAiKiActionApprove) ||
                    (actionReject && actionReject.dataset.swayAiKiActionReject) ||
                    ""
                ).trim();
                if(!proposalId) return;
                const review=actionApprove ? "approved" : "rejected";
                if(!window.confirm(actionApprove ? "Approve this controlled action proposal? It will still require explicit execution." : "Reject this controlled action proposal?")) return;

                const target=actionApprove||actionReject;
                target.disabled=true;
                target.textContent=actionApprove ? "Approving…" : "Rejecting…";
                try{
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_action_proposal",{
                        method:"POST",
                        headers:authHeaders(),
                        body:JSON.stringify({p_proposal_id:proposalId,p_decision:review})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok){
                        throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Controlled action review failed.");
                    }
                    await refreshExecutionPlans();
                }catch(error){
                    target.disabled=false;
                    target.textContent=actionApprove ? "Approve action" : "Reject";
                    window.alert(error.message||"Controlled action review failed.");
                }
                return;
            }

            if(actionExecute){
                const proposalId=String(actionExecute.dataset.swayAiKiActionExecute||"").trim();
                if(!proposalId) return;
                if(!window.confirm("Execute this approved InnerMe action now? This may create a task or send a client-facing email.")) return;
                actionExecute.disabled=true;
                actionExecute.textContent="Executing…";
                try{
                    const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                        method:"POST",
                        headers:authHeaders(),
                        body:JSON.stringify({action:"execute_innerme_action",proposal_id:proposalId})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok){
                        throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Controlled action execution failed.");
                    }
                    await refreshExecutionPlans();
                    window.alert(data.action_type==="send_email" ? "Approved email action executed and recorded." : "Approved task action executed and recorded.");
                }catch(error){
                    actionExecute.disabled=false;
                    actionExecute.textContent="Execute action";
                    window.alert(error.message||"Controlled action execution failed.");
                }
                return;
            }

            if(build){
                const decisionId=String(build.dataset.swayAiKiExecutionBuild||"").trim();
                if(!decisionId || !window.confirm("Build a governed execution plan for this approved decision?")) return;
                build.disabled=true;
                build.textContent="Building…";
                executionSummary.innerHTML='<p class="sway-ai-ki-muted">InnerMe is turning the approved decision into an evidence-linked execution plan…</p>';
                try{
                    const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                        method:"POST",
                        headers:authHeaders(),
                        body:JSON.stringify({action:"generate_execution_plan",decision_id:decisionId})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok){
                        throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Execution plan generation failed.");
                    }
                    await refreshExecutionPlans(false);
                    window.alert(data.created ? "Draft execution plan created. Review it before approving." : "An existing execution plan is already attached to this decision.");
                }catch(error){
                    build.disabled=false;
                    build.textContent="Build execution plan";
                    window.alert(error.message||"Execution plan generation failed.");
                }
                return;
            }

            const planId=String(
                approve?.dataset.swayAiKiExecutionApprove ||
                cancel?.dataset.swayAiKiExecutionCancel ||
                ""
            ).trim();
            const review=approve ? "approved" : "cancelled";
            if(!planId) return;

            const confirmation=approve
                ? "Approve this execution plan? It will be ready for controlled action proposals, but no workspace or external action will be executed yet."
                : "Cancel this execution plan draft?";

            if(!window.confirm(confirmation)) return;

            target.disabled=true;
            target.textContent=approve ? "Approving…" : "Cancelling…";

            try{
                const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_execution_plan",{
                    method:"POST",
                    headers:authHeaders(),
                    body:JSON.stringify({p_plan_id:planId,p_decision:review})
                });
                const data=await response.json().catch(function(){return null;});
                if(!response.ok){
                    throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Execution plan review failed.");
                }
                await refreshExecutionPlans();
                window.alert(approve ? "Execution plan approved and marked ready for controlled execution." : "Execution plan draft cancelled.");
            }catch(error){
                target.disabled=false;
                target.textContent=approve ? "Approve plan" : "Cancel draft";
                window.alert(error.message||"Execution plan review failed.");
            }
        });

        const outcomesPanel=details.querySelector("[data-sway-ai-ki-outcomes-panel]");
        const outcomesRefresh=details.querySelector("[data-sway-ai-ki-outcomes-refresh]");
        const outcomesSummary=details.querySelector(".sway-ai-ki-outcomes-summary");
        const outcomesResults=details.querySelector(".sway-ai-ki-outcomes-results");

        async function loadOutcomeReviews(){
            const plansResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_execution_plans?select=id,decision_id,title,objective,success_metric,expected_outcome,status,updated_at&status=in.(approved,active,completed,blocked,cancelled)&order=updated_at.desc&limit=50",{method:"GET",headers:authHeaders()});
            const plans=await plansResponse.json().catch(function(){return [];});
            if(!plansResponse.ok) throw new Error(plans && (plans.message||plans.error||plans.hint) ? String(plans.message||plans.error||plans.hint) : "Unable to load execution plans for outcome review.");
            const outcomesResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_outcomes?select=id,outcome_key,decision_id,plan_id,title,objective,success_metric,expected_outcome,status,attribution,measurement_method,result_summary,baseline_snapshot,latest_snapshot,evidence,assessment_notes,measurement_due_at,last_measured_at,verified_at,created_at,updated_at&order=updated_at.desc&limit=100",{method:"GET",headers:authHeaders()});
            const outcomes=await outcomesResponse.json().catch(function(){return [];});
            if(!outcomesResponse.ok) throw new Error(outcomes && (outcomes.message||outcomes.error||outcomes.hint) ? String(outcomes.message||outcomes.error||outcomes.hint) : "Unable to load InnerMe outcomes.");
            const rows=Array.isArray(outcomes)?outcomes:[];
            const planIds=(Array.isArray(plans)?plans:[]).map(function(p){return String(p.id||"");}).filter(Boolean);
            let observations=[];
            if(planIds.length){
                const outcomeIds=rows.map(function(o){return String(o.id||"");}).filter(Boolean);
                if(outcomeIds.length){
                    const obsResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_outcome_observations?select=id,outcome_id,observation_type,label,value,evidence,source_table,source_id,attribution,verification_status,measured_at&outcome_id=in.("+outcomeIds.join(",")+")&order=measured_at.desc&limit=300",{method:"GET",headers:authHeaders()});
                    const obsData=await obsResponse.json().catch(function(){return [];});
                    if(!obsResponse.ok) throw new Error(obsData && (obsData.message||obsData.error||obsData.hint) ? String(obsData.message||obsData.error||obsData.hint) : "Unable to load outcome observations.");
                    observations=Array.isArray(obsData)?obsData:[];
                }
            }
            return {plans:Array.isArray(plans)?plans:[],outcomes:rows,observations:observations};
        }

        function renderOutcomeReviews(data){
            const plans=Array.isArray(data&&data.plans)?data.plans:[];
            const outcomes=Array.isArray(data&&data.outcomes)?data.outcomes:[];
            const observations=Array.isArray(data&&data.observations)?data.observations:[];
            const byPlan=new Map(outcomes.map(function(o){return [String(o.plan_id||""),o];}));
            const counts={awaiting_signal:0,measuring:0,achieved:0,partially_achieved:0,not_achieved:0,inconclusive:0,blocked:0};
            outcomes.forEach(function(o){if(Object.prototype.hasOwnProperty.call(counts,String(o.status))) counts[String(o.status)]++;});
            outcomesSummary.innerHTML='<div class="sway-ai-ki-outcomes-summary-grid"><div><span>Plans</span><strong>'+esc(plans.length)+'</strong></div><div><span>Awaiting signal</span><strong>'+esc(counts.awaiting_signal)+'</strong></div><div><span>Measuring</span><strong>'+esc(counts.measuring)+'</strong></div><div><span>Reviewed</span><strong>'+esc(outcomes.filter(function(o){return ["achieved","partially_achieved","not_achieved","inconclusive"].includes(String(o.status));}).length)+'</strong></div></div>';
            if(!plans.length){return '<p class="sway-ai-ki-muted">No execution plans are available for outcome measurement yet.</p>';}
            return plans.map(function(plan){
                const outcome=byPlan.get(String(plan.id||""))||null;
                if(!outcome){
                    return '<article class="sway-ai-ki-outcome-item"><div class="sway-ai-ki-outcome-head"><div><strong>'+esc(plan.title||"Execution plan")+'</strong><span>'+esc(plan.status||"")+'</span></div><em>Not measured</em></div><p>'+esc(plan.objective||"")+'</p><div class="sway-ai-ki-outcome-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-outcome-prepare="'+esc(String(plan.id||""))+'">Start outcome review</button></div></article>';
                }
                const obs=observations.filter(function(o){return String(o.outcome_id||"")===String(outcome.id||"");});
                const snap=outcome.latest_snapshot && typeof outcome.latest_snapshot==="object" ? outcome.latest_snapshot : {};
                const reviewable=["awaiting_signal","measuring","blocked"].includes(String(outcome.status||""));
                const reviewActions=reviewable ? '<div class="sway-ai-ki-outcome-actions"><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-outcome-measure="'+esc(String(outcome.id||""))+'">Measure now</button><button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-outcome-review="'+esc(String(outcome.id||""))+'">Review outcome</button></div>' : '';
                const obsHtml=obs.slice(0,8).map(function(o){return '<div class="sway-ai-ki-outcome-observation"><span>'+esc(o.observation_type||"signal")+'</span><strong>'+esc(o.label||"Observation")+'</strong><em>'+esc(o.attribution||"uncertain")+'</em></div>';}).join("");
                return '<article class="sway-ai-ki-outcome-item"><div class="sway-ai-ki-outcome-head"><div><strong>'+esc(outcome.title||"Outcome review")+'</strong><span>Status: '+esc(outcome.status||"")+' · Attribution: '+esc(outcome.attribution||"uncertain")+'</span></div><em>'+esc(outcome.status||"")+'</em></div><div class="sway-ai-ki-outcome-grid"><div><span>Success metric</span><strong>'+esc(outcome.success_metric||"Not specified")+'</strong></div><div><span>Latest verified signals</span><strong>'+esc(String(snap.verified_actions||0))+' actions · '+esc(String(snap.email_replies_received||0))+' replies · '+esc(String(snap.completed_tasks||0))+' completed tasks</strong></div></div>'+(outcome.result_summary?'<p class="sway-ai-ki-outcome-summary-text">'+esc(outcome.result_summary)+'</p>':'')+(obsHtml?'<div class="sway-ai-ki-outcome-observations">'+obsHtml+'</div>':'')+reviewActions+'</article>';
            }).join("");
        }

        async function refreshOutcomeReviews(showLoading=true){
            if(showLoading) outcomesResults.innerHTML='<p class="sway-ai-ki-muted">Loading outcome reviews…</p>';
            try{
                const data=await loadOutcomeReviews();
                outcomesResults.innerHTML=renderOutcomeReviews(data);
                outcomesResults.__swayOutcomeData=data;
                return data;
            }catch(error){
                outcomesSummary.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Outcome intelligence failed to load.")+'</p>';
                outcomesResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Outcome intelligence failed to load.")+'</p>';
                return null;
            }
        }

        if(outcomesPanel) outcomesPanel.addEventListener("toggle",function(){if(outcomesPanel.open) refreshOutcomeReviews();});
        if(outcomesRefresh) outcomesRefresh.addEventListener("click",function(event){event.preventDefault();event.stopPropagation();refreshOutcomeReviews();});

        outcomesResults.addEventListener("click",async function(event){
            const prepare=event.target&&event.target.closest?event.target.closest("[data-sway-ai-ki-outcome-prepare]"):null;
            const measure=event.target&&event.target.closest?event.target.closest("[data-sway-ai-ki-outcome-measure]"):null;
            const review=event.target&&event.target.closest?event.target.closest("[data-sway-ai-ki-outcome-review]"):null;
            const target=prepare||measure||review;
            if(!target) return;
            event.preventDefault(); event.stopPropagation();
            try{
                if(prepare){
                    const planId=String(prepare.dataset.swayAiKiOutcomePrepare||"").trim();
                    if(!planId||!window.confirm("Start outcome measurement for this execution plan?")) return;
                    prepare.disabled=true; prepare.textContent="Starting…";
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/prepare_innerme_outcome_review",{method:"POST",headers:authHeaders(),body:JSON.stringify({p_plan_id:planId})});
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Outcome review preparation failed.");
                    await refreshOutcomeReviews(false);
                    return;
                }
                if(measure){
                    const outcomeId=String(measure.dataset.swayAiKiOutcomeMeasure||"").trim();
                    if(!outcomeId) return;
                    measure.disabled=true; measure.textContent="Measuring…";
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/measure_innerme_outcome",{method:"POST",headers:authHeaders(),body:JSON.stringify({p_outcome_id:outcomeId})});
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Outcome measurement failed.");
                    await refreshOutcomeReviews(false);
                    return;
                }
                if(review){
                    const outcomeId=String(review.dataset.swayAiKiOutcomeReview||"").trim();
                    if(!outcomeId) return;
                    const status=window.prompt("Outcome status: achieved, partially_achieved, not_achieved, or inconclusive","inconclusive");
                    if(!status||!["achieved","partially_achieved","not_achieved","inconclusive"].includes(status.trim())) return;
                    const attribution=window.prompt("Attribution: direct, partial, uncertain, or none","uncertain");
                    if(!attribution||!["direct","partial","uncertain","none"].includes(attribution.trim())) return;
                    const summary=window.prompt("Brief evidence-based outcome summary","");
                    review.disabled=true; review.textContent="Saving…";
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_outcome",{method:"POST",headers:authHeaders(),body:JSON.stringify({p_outcome_id:outcomeId,p_status:status.trim(),p_attribution:attribution.trim(),p_summary:summary||null})});
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Outcome review failed.");
                    await refreshOutcomeReviews(false);
                }
            }catch(error){
                target.disabled=false;
                window.alert(error.message||"Outcome intelligence action failed.");
            }
        });

        const experimentsPanel=details.querySelector("[data-sway-ai-ki-experiments-panel]");
        const experimentsRefresh=details.querySelector("[data-sway-ai-ki-experiments-refresh]");
        const experimentsSummary=details.querySelector(".sway-ai-ki-experiments-summary");
        const experimentsResults=details.querySelector(".sway-ai-ki-experiments-results");

        async function loadExperiments(){
            const response=await fetch(SUPABASE_URL+"/rest/v1/innerme_experiments?select=id,name,hypothesis,action,success_metric,status,review_date,result,learning,objective,intervention,comparison_condition,baseline,target,guardrail_metric,guardrail_rule,measurement_method,test_window_days,design,evidence,confidence,decision_id,plan_id,outcome_id,approved_at,started_at,reviewed_at,decision_after_review,created_at,updated_at&order=updated_at.desc&limit=100",{method:"GET",headers:authHeaders()});
            const data=await response.json().catch(function(){return [];});
            if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Unable to load InnerMe experiments.");
            const experiments=Array.isArray(data)?data:[];
            const ids=experiments.map(function(e){return String(e.id||"");}).filter(Boolean);
            let observations=[];
            if(ids.length){
                const obsResponse=await fetch(SUPABASE_URL+"/rest/v1/innerme_experiment_observations?select=id,experiment_id,metric_name,label,value,evidence,source_table,source_id,attribution,verification_status,interpretation,observed_at&experiment_id=in.("+ids.join(",")+")&order=observed_at.desc&limit=500",{method:"GET",headers:authHeaders()});
                const obsData=await obsResponse.json().catch(function(){return [];});
                if(!obsResponse.ok) throw new Error(obsData&&(obsData.message||obsData.error||obsData.hint)?String(obsData.message||obsData.error||obsData.hint):"Unable to load experiment observations.");
                observations=Array.isArray(obsData)?obsData:[];
            }
            return {experiments:experiments,observations:observations};
        }

        function renderExperiments(data){
            const experiments=Array.isArray(data&&data.experiments)?data.experiments:[];
            const observations=Array.isArray(data&&data.observations)?data.observations:[];
            const counts={idea:0,proposed:0,approved:0,running:0,completed:0,paused:0,abandoned:0,inconclusive:0};
            experiments.forEach(function(e){if(Object.prototype.hasOwnProperty.call(counts,String(e.status))) counts[String(e.status)]++;});
            experimentsSummary.innerHTML='<div class="sway-ai-ki-experiments-summary-grid"><div><span>Ideas</span><strong>'+esc(counts.idea)+'</strong></div><div><span>Proposed</span><strong>'+esc(counts.proposed)+'</strong></div><div><span>Approved</span><strong>'+esc(counts.approved)+'</strong></div><div><span>Running</span><strong>'+esc(counts.running)+'</strong></div><div><span>Completed</span><strong>'+esc(counts.completed)+'</strong></div><div><span>Inconclusive</span><strong>'+esc(counts.inconclusive)+'</strong></div></div>';
            if(!experiments.length) return '<p class="sway-ai-ki-muted">No experiments exist yet. Phase 12 is ready for real experiments, but no synthetic records were created.</p>';
            return experiments.map(function(e){
                const obs=observations.filter(function(o){return String(o.experiment_id||"")===String(e.id||"");});
                const canApprove=["idea","proposed"].includes(String(e.status||""));
                const canStart=String(e.status||"")==="approved";
                const canPause=String(e.status||"")==="running";
                const canReview=["running","paused","approved"].includes(String(e.status||""));
                const buttons=(canApprove?'<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-experiment-action="approved" data-id="'+esc(String(e.id||""))+'">Approve</button>': '')+(canStart?'<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-experiment-action="running" data-id="'+esc(String(e.id||""))+'">Start</button>':'')+(canPause?'<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-experiment-action="paused" data-id="'+esc(String(e.id||""))+'">Pause</button>':'')+(canReview?'<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-experiment-review="'+esc(String(e.id||""))+'">Review</button>':'');
                const obsHtml=obs.slice(0,6).map(function(o){return '<div class="sway-ai-ki-experiment-observation"><span>'+esc(o.metric_name||"metric")+'</span><strong>'+esc(o.label||"Observation")+'</strong><em>'+esc(o.attribution||"uncertain")+'</em></div>';}).join("");
                return '<article class="sway-ai-ki-experiment-item"><div class="sway-ai-ki-experiment-head"><div><strong>'+esc(e.name||"Experiment")+'</strong><span>'+esc(e.status||"")+' · confidence: '+esc(e.confidence||"medium")+'</span></div><em>'+esc(e.status||"")+'</em></div><p><b>Hypothesis:</b> '+esc(e.hypothesis||"Not specified")+'</p><div class="sway-ai-ki-experiment-grid"><div><span>Intervention</span><strong>'+esc(e.intervention||e.action||"Not specified")+'</strong></div><div><span>Success metric</span><strong>'+esc(e.success_metric||"Not specified")+'</strong></div><div><span>Target</span><strong>'+esc(e.target||"Not specified")+'</strong></div><div><span>Guardrail</span><strong>'+esc(e.guardrail_metric||"Not specified")+'</strong></div></div>'+(e.result?'<p><b>Result:</b> '+esc(e.result)+'</p>':'')+(e.learning?'<p><b>Learning:</b> '+esc(e.learning)+'</p>':'')+(obsHtml?'<div class="sway-ai-ki-experiment-observations">'+obsHtml+'</div>':'')+'<div class="sway-ai-ki-experiment-actions">'+buttons+'</div></article>';
            }).join("");
        }

        async function refreshExperiments(showLoading=true){
            if(showLoading) experimentsResults.innerHTML='<p class="sway-ai-ki-muted">Loading experiments…</p>';
            try{const data=await loadExperiments();experimentsResults.innerHTML=renderExperiments(data);experimentsResults.__swayExperimentData=data;return data;}catch(error){experimentsSummary.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Experimentation failed to load.")+'</p>';experimentsResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message||"Experimentation failed to load.")+'</p>';return null;}
        }

        if(experimentsPanel) experimentsPanel.addEventListener("toggle",function(){if(experimentsPanel.open) refreshExperiments();});
        if(experimentsRefresh) experimentsRefresh.addEventListener("click",function(event){event.preventDefault();event.stopPropagation();refreshExperiments();});
        experimentsResults.addEventListener("click",async function(event){
            const action=event.target&&event.target.closest?event.target.closest("[data-sway-ai-ki-experiment-action]"):null;
            const review=event.target&&event.target.closest?event.target.closest("[data-sway-ai-ki-experiment-review]"):null;
            if(!action&&!review) return;
            event.preventDefault();event.stopPropagation();
            const id=String((action||review).dataset.id||(review&&review.dataset.swayAiKiExperimentReview)||"").trim();
            try{
                if(action){
                    const status=String(action.dataset.swayAiKiExperimentAction||"");
                    if(!id||!["approved","running","paused"].includes(status)) return;
                    if(!window.confirm(status==="approved"?"Approve this experiment design?":status==="running"?"Start this approved experiment?":"Pause this running experiment?")) return;
                    action.disabled=true;action.textContent=status==="running"?"Starting…":status==="paused"?"Pausing…":"Approving…";
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_experiment",{method:"POST",headers:authHeaders(),body:JSON.stringify({p_experiment_id:id,p_status:status,p_result:null,p_learning:null,p_decision_after_review:null})});
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Experiment status update failed.");
                    await refreshExperiments(false);return;
                }
                if(review){
                    const status=window.prompt("Review status: completed, paused, abandoned, or inconclusive","completed");
                    if(!status||!["completed","paused","abandoned","inconclusive"].includes(status.trim())) return;
                    const result=window.prompt("Observed result / evidence summary","");
                    const learning=window.prompt("Learning captured from this experiment","");
                    const decision=window.prompt("Decision after review: keep, change, stop, or inconclusive","inconclusive");
                    review.disabled=true;review.textContent="Saving…";
                    const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/review_innerme_experiment",{method:"POST",headers:authHeaders(),body:JSON.stringify({p_experiment_id:id,p_status:status.trim(),p_result:result||null,p_learning:learning||null,p_decision_after_review:decision||null})});
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok) throw new Error(data&&(data.message||data.error||data.hint)?String(data.message||data.error||data.hint):"Experiment review failed.");
                    await refreshExperiments(false);
                }
            }catch(error){(action||review).disabled=false;window.alert(error.message||"Experiment action failed.");}
        });

        const evaluationPanel = details.querySelector("[data-sway-ai-ki-evaluation-panel]");
        const evaluationSummary = details.querySelector(".sway-ai-ki-evaluation-summary");
        const evaluationResults = details.querySelector(".sway-ai-ki-evaluation-results");
        const evaluationRun = details.querySelector("[data-sway-ai-ki-eval-run]");
        const evaluationRefresh = details.querySelector("[data-sway-ai-ki-eval-refresh]");

        async function loadEvaluationResults() {
            const runsResponse = await fetch(
                SUPABASE_URL +
                    "/rest/v1/innerme_evaluation_runs?select=id,trigger,provider_model,total_cases,passed_cases,failed_cases,pass_rate,average_score,started_at,completed_at,status,benchmark_version,baseline_run_id,delta_average_score,delta_pass_rate,regression_status,critical_failures,regression_summary,summary&order=started_at.desc&limit=6",
                { method:"GET", headers:authHeaders() }
            );
            const runs = await runsResponse.json().catch(function(){return [];});
            if(!runsResponse.ok){
                throw new Error(runs && (runs.message || runs.error || runs.hint) ? String(runs.message || runs.error || runs.hint) : "Unable to load benchmark runs.");
            }

            const latest=Array.isArray(runs) ? runs[0] : null;
            if(!latest) return {latest:null,results:[],history:[]};

            const casesResponse=await fetch(
                SUPABASE_URL + "/rest/v1/innerme_evaluation_cases?select=id,case_key,title,severity&status=eq.active&limit=50",
                { method:"GET", headers:authHeaders() }
            );
            const cases=await casesResponse.json().catch(function(){return [];});
            if(!casesResponse.ok){
                throw new Error(cases && (cases.message || cases.error || cases.hint) ? String(cases.message || cases.error || cases.hint) : "Unable to load benchmark case definitions.");
            }

            const caseMap=new Map((Array.isArray(cases)?cases:[]).map(function(item){
                return [String(item.id || ""),item];
            }));

            const resultsResponse=await fetch(
                SUPABASE_URL +
                    "/rest/v1/innerme_evaluation_results?select=id,run_id,case_id,case_key,severity,prompt,answer,retrieval_matches,attributed_knowledge,dimension_scores,score,passed,judge_rationale,provider_model,created_at&run_id=eq."+encodeURIComponent(latest.id)+"&order=score.asc",
                { method:"GET", headers:authHeaders() }
            );
            const results=await resultsResponse.json().catch(function(){return [];});
            if(!resultsResponse.ok){
                throw new Error(results && (results.message || results.error || results.hint) ? String(results.message || results.error || results.hint) : "Unable to load benchmark case results.");
            }

            return {
                latest:latest,
                results:(Array.isArray(results)?results:[]).map(function(result){
                    return Object.assign({},result,{case_definition:caseMap.get(String(result.case_id || "")) || null});
                }),
                history:Array.isArray(runs) ? runs : []
            };
        }

        function formatEvalDate(value) {
            if(!value) return "Unknown";
            const date=new Date(value);
            return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
        }

        function regressionLabel(status) {
            const labels={baseline:"Baseline",stable:"Stable",improved:"Improved",regressed:"REGRESSION",inconclusive:"Inconclusive"};
            return labels[String(status || "")] || "Unknown";
        }

        function renderEvaluation(data) {
            const latest=data.latest;
            const results=data.results || [];
            const history=data.history || [];

            if(!latest){
                evaluationSummary.innerHTML='<p class="sway-ai-ki-muted">No benchmark run has been completed yet.</p>';
                evaluationResults.innerHTML='<p class="sway-ai-ki-muted">Run the benchmark to establish the first InnerMe baseline.</p>';
                return;
            }

            const regressionStatus=String(latest.regression_status || "baseline");
            const regressionClass=
                regressionStatus==="regressed" ? "sway-ai-ki-eval-regressed" :
                regressionStatus==="improved" ? "sway-ai-ki-eval-improved" :
                "sway-ai-ki-eval-neutral";

            const deltaScore=Number(latest.delta_average_score);
            const deltaPass=Number(latest.delta_pass_rate);

            evaluationSummary.innerHTML=
                '<div class="sway-ai-ki-eval-summary-grid">' +
                    '<div><span>Average score</span><strong>'+esc(Number(latest.average_score || 0).toFixed(2))+'/100</strong></div>' +
                    '<div><span>Pass rate</span><strong>'+esc(Number(latest.pass_rate || 0).toFixed(2))+'%</strong></div>' +
                    '<div><span>Passed</span><strong>'+esc(latest.passed_cases || 0)+' / '+esc(latest.total_cases || 0)+'</strong></div>' +
                    '<div><span>Regression status</span><strong class="'+regressionClass+'">'+esc(regressionLabel(regressionStatus))+'</strong></div>' +
                '</div>' +
                '<div class="sway-ai-ki-eval-baseline">' +
                    '<span>Baseline delta: score '+esc(Number.isFinite(deltaScore) ? (deltaScore>0?"+":"")+deltaScore.toFixed(2) : "Not available")+
                    ' · pass rate '+esc(Number.isFinite(deltaPass) ? (deltaPass>0?"+":"")+deltaPass.toFixed(2)+"%" : "Not available")+
                    ' · critical failures '+esc(latest.critical_failures || 0)+'</span>' +
                    '<span>Latest run: '+esc(formatEvalDate(latest.completed_at || latest.started_at))+'</span>' +
                '</div>' +
                '<p class="sway-ai-ki-foot">Regression policy: any newly failed case, a 5+ point average-score drop, a 10+ point pass-rate drop, or a critical-case failure is flagged.</p>';

            if(!results.length){
                evaluationResults.innerHTML='<p class="sway-ai-ki-error">The benchmark run exists but contains no case results.</p>';
                return;
            }

            evaluationResults.innerHTML=
                '<div class="sway-ai-ki-eval-history"><strong>Recent runs</strong>' +
                    history.map(function(run){
                        const status=String(run.regression_status || "baseline");
                        return '<div><span>'+esc(formatEvalDate(run.completed_at || run.started_at))+'</span><span>'+esc(Number(run.average_score || 0).toFixed(1))+'/100 · '+esc(Number(run.pass_rate || 0).toFixed(1))+'% · '+esc(regressionLabel(status))+'</span></div>';
                    }).join("") +
                '</div>' +
                results.map(function(result){
                    const dims=result.dimension_scores || {};
                    const recall=Number(dims.retrieval_recall || 0);
                    const status=result.passed===true ? "PASS" : "FAIL";
                    const className=result.passed===true ? "sway-ai-ki-eval-pass" : "sway-ai-ki-eval-fail";
                    const definition=result.case_definition || {};
                    const title=definition.title || result.case_key || "Benchmark case";
                    const flags=Array.isArray(result.failure_flags) ? result.failure_flags : [];
                    return '<article class="sway-ai-ki-eval-item">' +
                        '<div class="sway-ai-ki-eval-head"><div><strong>'+esc(title)+'</strong><span>'+esc(result.case_key || "")+' · '+esc(result.severity || definition.severity || "standard")+' · '+esc(Number(result.score || 0).toFixed(0))+'/100</span></div><em class="'+className+'">'+esc(status)+'</em></div>' +
                        '<p><strong>Question:</strong> '+esc(result.prompt || "")+'</p>' +
                        '<p><strong>Retrieval recall:</strong> '+esc(recall)+'%</p>' +
                        '<div class="sway-ai-ki-eval-dims">' +
                            '<span>Correctness '+esc(dims.correctness || 0)+'</span>' +
                            '<span>Grounding '+esc(dims.grounding || 0)+'</span>' +
                            '<span>Relevance '+esc(dims.relevance || 0)+'</span>' +
                            '<span>Safety '+esc(dims.safety || 0)+'</span>' +
                            '<span>Completeness '+esc(dims.completeness || 0)+'</span>' +
                        '</div>' +
                        (flags.length ? '<div class="sway-ai-ki-eval-flags">'+flags.map(function(flag){return '<span>'+esc(String(flag).replace(/_/g," "))+'</span>';}).join("")+'</div>' : "") +
                        '<details><summary>View answer &amp; judge rationale</summary>' +
                            '<div class="sway-ai-ki-eval-answer"><strong>InnerMe answer</strong><p>'+esc(result.answer || "No answer recorded.")+'</p><strong>Judge rationale</strong><p>'+esc(result.judge_rationale || "No rationale recorded.")+'</p></div>' +
                        '</details>' +
                    '</article>';
                }).join("");
        }

        async function refreshEvaluation() {
            evaluationResults.innerHTML='<p class="sway-ai-ki-muted">Loading latest benchmark…</p>';
            try {
                const data=await loadEvaluationResults();
                renderEvaluation(data);
            } catch(error) {
                evaluationResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message || "Benchmark results failed to load.")+'</p>';
            }
        }

        if(evaluationPanel){
            evaluationPanel.addEventListener("toggle",function(){
                if(evaluationPanel.open) refreshEvaluation();
            });
        }

        if(evaluationRefresh){
            evaluationRefresh.addEventListener("click",function(event){
                event.preventDefault();
                event.stopPropagation();
                refreshEvaluation();
            });
        }

        if(evaluationRun){
            evaluationRun.addEventListener("click",async function(event){
                event.preventDefault();
                event.stopPropagation();
                if(evaluationRun.disabled) return;

                evaluationRun.disabled=true;
                evaluationRun.textContent="Running…";
                evaluationSummary.innerHTML='<p class="sway-ai-ki-muted">Running the fixed benchmark cases…</p>';
                evaluationResults.innerHTML='<p class="sway-ai-ki-muted">InnerMe is being evaluated case by case.</p>';

                try{
                    const response=await fetch(SUPABASE_URL+"/functions/v1/swayphics-ai",{
                        method:"POST",
                        headers:authHeaders(),
                        body:JSON.stringify({action:"run_innerme_benchmark",benchmark_limit:12})
                    });
                    const data=await response.json().catch(function(){return null;});
                    if(!response.ok){
                        throw new Error(data && (data.message || data.error || data.hint) ? String(data.message || data.error || data.hint) : "Benchmark execution failed.");
                    }
                    await refreshEvaluation();
                    window.alert(
                        "Benchmark complete: " +
                        String(data.passed_cases || 0) +
                        "/" +
                        String(data.completed_cases || data.total_cases || 0) +
                        " cases passed, average score " +
                        String(data.average_score || 0) +
                        "/100."
                    );
                }catch(error){
                    evaluationResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message || "Benchmark execution failed.")+'</p>';
                }finally{
                    evaluationRun.disabled=false;
                    evaluationRun.textContent="Run benchmark";
                }
            });
        }

        const acquisitionPanel = details.querySelector("[data-sway-ai-ki-acquisition-panel]");
        const acquisitionResults = details.querySelector(".sway-ai-ki-acquisition-results");
        const acquisitionRefresh = details.querySelector("[data-sway-ai-ki-acq-refresh]");

        async function refreshAcquisitionTasks() {
            acquisitionResults.innerHTML='<p class="sway-ai-ki-muted">Loading acquisition tasks…</p>';
            try {
                const items=await loadAcquisitionTasks();
                acquisitionResults.innerHTML=renderAcquisitionQueue(items);
                acquisitionResults.__swayAcquisitionItems=items;
            } catch(error) {
                acquisitionResults.innerHTML='<p class="sway-ai-ki-error">'+esc(error.message || "Acquisition tasks failed to load.")+'</p>';
                acquisitionResults.__swayAcquisitionItems=[];
            }
        }

        if(acquisitionPanel){
            acquisitionPanel.addEventListener("toggle",function(){
                if(acquisitionPanel.open) refreshAcquisitionTasks();
            });
        }

        if(acquisitionRefresh){
            acquisitionRefresh.addEventListener("click",function(event){
                event.preventDefault();
                event.stopPropagation();
                refreshAcquisitionTasks();
            });
        }

        acquisitionResults.addEventListener("submit",function(event){
            const form=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-acquisition-form]") : null;
            if(!form) return;
            event.preventDefault();
            event.stopPropagation();
            saveAcquisitionSource(form.dataset.swayAiKiAcquisitionForm || "",form);
        });

        acquisitionResults.addEventListener("click",function(event){
            const draftTarget=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-acq-draft]") : null;
            const publishTarget=event.target && event.target.closest ? event.target.closest("[data-sway-ai-ki-acq-publish]") : null;

            if(draftTarget){
                event.preventDefault();
                event.stopPropagation();
                generateAcquisitionDraft(draftTarget.dataset.swayAiKiAcqDraft || "",acquisitionResults);
                return;
            }

            if(publishTarget){
                event.preventDefault();
                event.stopPropagation();
                verifyIndexAndPublish(publishTarget.dataset.swayAiKiAcqPublish || "",acquisitionResults);
            }
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
        ".sway-ai-ki-eval-regressed{color:#b42318!important}" +
        ".sway-ai-ki-eval-improved{color:#157347!important}" +
        ".sway-ai-ki-eval-neutral{color:#0152F4!important}" +
        ".sway-ai-ki-eval-baseline{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:8px;line-height:1.4;opacity:.68}" +
        ".sway-ai-ki-eval-history{display:grid;gap:5px;padding:8px 9px;border:1px solid rgba(1,82,244,.08);border-radius:10px}" +
        ".sway-ai-ki-eval-history>strong{font-size:9px}" +
        ".sway-ai-ki-eval-history>div{display:flex;justify-content:space-between;gap:8px;font-size:8px;line-height:1.4;opacity:.72}" +
        ".sway-ai-ki-eval-flags{display:flex;flex-wrap:wrap;gap:5px}" +
        ".sway-ai-ki-eval-flags span{padding:3px 5px;border-radius:999px;background:rgba(220,53,69,.08);color:#b42318;font-size:7px;font-weight:700}" +
        "body.sway-dark-mode .sway-ai-ki-eval-regressed{color:#FFB0B0!important}" +
        "body.sway-dark-mode .sway-ai-ki-eval-improved{color:#91E8B0!important}" +
        "body.sway-dark-mode .sway-ai-ki-eval-neutral{color:#9FD5FF!important}" +
        "body.sway-dark-mode .sway-ai-ki-eval-history{border-color:rgba(119,193,252,.1);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-eval-flags span{background:rgba(190,52,52,.14);color:#FFB0B0}" +
        ".sway-ai-ki-decisions{width:100%;margin:4px 0}" +
        ".sway-ai-ki-decisions>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-decisions>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-decisions>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-decisions[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-decisions-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-decisions-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-decisions-summary,.sway-ai-ki-decisions-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-decision-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-decision-summary-grid>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-decision-summary-grid span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-decision-summary-grid strong{font-size:11px}" +
        ".sway-ai-ki-decision-item{display:grid;gap:8px;padding:11px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-decision-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-decision-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-decision-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-decision-head span{font-size:8px;opacity:.6;text-transform:capitalize}" +
        ".sway-ai-ki-decision-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800}" +
        ".sway-ai-ki-decision-main{margin:0;font-size:10px;line-height:1.55;font-weight:650}" +
        ".sway-ai-ki-decision-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-decision-grid>div{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-decision-grid span,.sway-ai-ki-decision-evidence>span{font-size:8px;opacity:.55}" +
        ".sway-ai-ki-decision-grid strong{font-size:9px;font-weight:600;line-height:1.4}" +
        ".sway-ai-ki-decision-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:8px;opacity:.65}" +
        ".sway-ai-ki-decision-evidence{display:grid;gap:5px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-decision-evidence>span:first-child{font-size:8px}" +
        ".sway-ai-ki-decision-evidence>span:not(:first-child){font-size:8px;line-height:1.4;padding:5px 6px;border-radius:7px;background:rgba(1,82,244,.045);overflow-wrap:anywhere}" +
        "body.sway-dark-mode .sway-ai-ki-decision-summary-grid>div,body.sway-dark-mode .sway-ai-ki-decision-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-decision-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-decision-grid>div,body.sway-dark-mode .sway-ai-ki-decision-evidence{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-decision-evidence>span:not(:first-child){background:rgba(119,193,252,.055)}" +
        "@media(max-width:680px){.sway-ai-ki-decision-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-decision-head{display:grid;gap:6px}.sway-ai-ki-decision-grid{grid-template-columns:1fr}}" +
        ".sway-ai-ki-execution{width:100%;margin:4px 0}" +
        ".sway-ai-ki-execution>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-execution>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-execution>summary:after{content:\"›\";transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-execution[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-execution-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-execution-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-execution-summary,.sway-ai-ki-execution-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-execution-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-execution-summary-grid>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-execution-summary-grid span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-execution-summary-grid strong{font-size:11px}" +
        ".sway-ai-ki-execution-item{display:grid;gap:8px;padding:11px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-execution-head,.sway-ai-ki-execution-plan-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-execution-head>div,.sway-ai-ki-execution-plan-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-execution-head strong,.sway-ai-ki-execution-plan-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-execution-head span,.sway-ai-ki-execution-plan-head span{font-size:8px;opacity:.6;text-transform:capitalize}" +
        ".sway-ai-ki-execution-head em,.sway-ai-ki-execution-badge{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-execution-decision{margin:0;font-size:10px;line-height:1.55;font-weight:650}" +
        ".sway-ai-ki-execution-decision-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:8px;opacity:.65}" +
        ".sway-ai-ki-execution-plan{display:grid;gap:8px;padding:10px;border:1px solid rgba(1,82,244,.1);border-radius:11px}" +
        ".sway-ai-ki-execution-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-execution-grid>div,.sway-ai-ki-execution-detail{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-execution-grid span,.sway-ai-ki-execution-detail>span{font-size:8px;opacity:.55}" +
        ".sway-ai-ki-execution-grid strong,.sway-ai-ki-execution-detail strong{font-size:9px;font-weight:600;line-height:1.45}" +
        ".sway-ai-ki-execution-detail ul{margin:0;padding-left:16px;display:grid;gap:4px}" +
        ".sway-ai-ki-execution-detail li{font-size:9px;line-height:1.4}" +
        ".sway-ai-ki-execution-steps{display:grid;gap:7px}" +
        ".sway-ai-ki-execution-step{display:grid;gap:5px;padding:8px;border-radius:9px;background:rgba(1,82,244,.035)}" +
        ".sway-ai-ki-execution-step-head{display:flex;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-execution-step-head strong{font-size:9px;line-height:1.4}" +
        ".sway-ai-ki-execution-step-head span{font-size:7px;text-transform:capitalize;opacity:.6}" +
        ".sway-ai-ki-execution-step p{margin:0;font-size:9px;line-height:1.45}" +
        ".sway-ai-ki-execution-step-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:7px;opacity:.62}" +
        ".sway-ai-ki-execution-step-detail{display:grid;gap:2px;padding-top:5px;border-top:1px solid rgba(1,82,244,.07)}" +
        ".sway-ai-ki-execution-step-detail span{font-size:7px;opacity:.55}" +
        ".sway-ai-ki-execution-step-detail strong{font-size:8px;line-height:1.4}" +
        ".sway-ai-ki-execution-evidence{display:grid;gap:5px}" +
        ".sway-ai-ki-execution-evidence span{font-size:8px;line-height:1.4;padding:5px 6px;border-radius:7px;background:rgba(1,82,244,.045);overflow-wrap:anywhere}" +
        ".sway-ai-ki-execution-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}" +
        ".sway-ai-ki-execution-note{font-size:8px;line-height:1.45;opacity:.68;padding:7px 8px;border-radius:8px;background:rgba(1,82,244,.035)}" +
        "body.sway-dark-mode .sway-ai-ki-execution-summary-grid>div,body.sway-dark-mode .sway-ai-ki-execution-item,body.sway-dark-mode .sway-ai-ki-execution-plan{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-execution-head em,body.sway-dark-mode .sway-ai-ki-execution-badge{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-execution-grid>div,body.sway-dark-mode .sway-ai-ki-execution-detail,body.sway-dark-mode .sway-ai-ki-execution-step-detail{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-execution-step,body.sway-dark-mode .sway-ai-ki-execution-evidence span,body.sway-dark-mode .sway-ai-ki-execution-note{background:rgba(119,193,252,.055)}" +
        "@media(max-width:680px){.sway-ai-ki-execution-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-execution-head,.sway-ai-ki-execution-plan-head{display:grid;gap:6px}.sway-ai-ki-execution-grid{grid-template-columns:1fr}}" +
        ".sway-ai-ki-execution-actions-list{display:grid;gap:7px}" +
        ".sway-ai-ki-execution-action{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-execution-action-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}" +
        ".sway-ai-ki-execution-action-head>div{display:grid;gap:2px;min-width:0}" +
        ".sway-ai-ki-execution-action-head strong{font-size:9px;line-height:1.35}" +
        ".sway-ai-ki-execution-action-head span{font-size:7px;opacity:.6}" +
        ".sway-ai-ki-execution-action-head em{padding:3px 5px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:7px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-execution-action>p{margin:0;font-size:8px;line-height:1.4;opacity:.75}" +
        ".sway-ai-ki-execution-action-payload{display:grid;gap:2px;padding-top:5px;border-top:1px solid rgba(1,82,244,.07)}" +
        ".sway-ai-ki-execution-action-payload span{font-size:7px;opacity:.55}" +
        ".sway-ai-ki-execution-action-payload strong{font-size:8px;line-height:1.35}" +
        ".sway-ai-ki-execution-action-payload p{margin:0;font-size:8px;line-height:1.4;white-space:pre-wrap}" +
        ".sway-ai-ki-execution-action-error{font-size:8px;line-height:1.4;padding:6px;border-radius:7px;background:rgba(220,53,69,.07);color:#b42318}" +
        ".sway-ai-ki-execution-action-result{font-size:7px;line-height:1.4;opacity:.62}" +
        "body.sway-dark-mode .sway-ai-ki-execution-action{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-execution-action-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-execution-action-payload{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-execution-action-error{background:rgba(190,52,52,.14);color:#FFB0B0}" +
        ".sway-ai-ki-evaluation{width:100%;margin:4px 0}" +
        ".sway-ai-ki-evaluation>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-evaluation>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-evaluation>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-evaluation[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-evaluation-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-evaluation-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-evaluation-summary,.sway-ai-ki-evaluation-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-eval-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-eval-summary-grid>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-eval-summary-grid span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-eval-summary-grid strong{font-size:11px}" +
        ".sway-ai-ki-eval-item{display:grid;gap:7px;padding:10px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-eval-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-eval-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-eval-head strong{font-size:10px}" +
        ".sway-ai-ki-eval-head span{font-size:9px;opacity:.6}" +
        ".sway-ai-ki-eval-head em{padding:4px 6px;border-radius:999px;font-size:8px;font-style:normal;font-weight:800}" +
        ".sway-ai-ki-eval-pass{background:rgba(34,197,94,.1);color:#157347}" +
        ".sway-ai-ki-eval-fail{background:rgba(220,53,69,.1);color:#b42318}" +
        ".sway-ai-ki-eval-item>p{margin:0;font-size:9px;line-height:1.45}" +
        ".sway-ai-ki-eval-dims{display:flex;flex-wrap:wrap;gap:5px;font-size:8px;line-height:1.35;opacity:.7}" +
        ".sway-ai-ki-eval-item details{border-top:1px solid rgba(1,82,244,.08);padding-top:6px}" +
        ".sway-ai-ki-eval-item summary{font-size:9px;cursor:pointer}" +
        ".sway-ai-ki-eval-answer{display:grid;gap:4px;margin-top:7px}" +
        ".sway-ai-ki-eval-answer strong{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-eval-answer p{margin:0;font-size:9px;line-height:1.5;white-space:pre-wrap}" +
        "body.sway-dark-mode .sway-ai-ki-eval-summary-grid>div,body.sway-dark-mode .sway-ai-ki-eval-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-eval-pass{background:rgba(34,197,94,.14);color:#91E8B0}" +
        "body.sway-dark-mode .sway-ai-ki-eval-fail{background:rgba(190,52,52,.14);color:#FFB0B0}" +
        "body.sway-dark-mode .sway-ai-ki-eval-item details{border-top-color:rgba(119,193,252,.1)}" +
        "@media(max-width:680px){.sway-ai-ki-eval-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-eval-head{display:grid;gap:6px}.sway-ai-ki-eval-head em{width:fit-content}}" +
        ".sway-ai-ki-experiments{width:100%;margin:4px 0}" +
        ".sway-ai-ki-experiments>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-experiments>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-experiments>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-experiments[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-experiments-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-experiments-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-experiments-summary,.sway-ai-ki-experiments-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-experiments-summary-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-experiments-summary-grid>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-experiments-summary-grid span,.sway-ai-ki-experiment-grid span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-experiments-summary-grid strong{font-size:11px}" +
        ".sway-ai-ki-experiment-item{display:grid;gap:9px;padding:11px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-experiment-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-experiment-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-experiment-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-experiment-head span{font-size:9px;opacity:.58}" +
        ".sway-ai-ki-experiment-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-experiment-item>p{margin:0;font-size:10px;line-height:1.5}" +
        ".sway-ai-ki-experiment-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-experiment-grid>div{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-experiment-grid strong{font-size:9px;font-weight:600;line-height:1.4}" +
        ".sway-ai-ki-experiment-observations{display:grid;gap:5px}" +
        ".sway-ai-ki-experiment-observation{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center;padding:6px 7px;border-radius:8px;background:rgba(1,82,244,.035);font-size:8px}" +
        ".sway-ai-ki-experiment-observation span,.sway-ai-ki-experiment-observation em{opacity:.58;font-style:normal}" +
        ".sway-ai-ki-experiment-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}" +
        "body.sway-dark-mode .sway-ai-ki-experiments-summary-grid>div,body.sway-dark-mode .sway-ai-ki-experiment-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-experiment-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-experiment-grid>div{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-experiment-observation{background:rgba(119,193,252,.055)}" +
        "@media(max-width:900px){.sway-ai-ki-experiments-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}" +
        "@media(max-width:680px){.sway-ai-ki-experiments-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-experiment-head{display:grid;gap:6px}.sway-ai-ki-experiment-head em{width:fit-content}.sway-ai-ki-experiment-grid{grid-template-columns:1fr}}" +
        ".sway-ai-ki-outcomes{width:100%;margin:4px 0}" +
        ".sway-ai-ki-outcomes>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-outcomes>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-outcomes>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-outcomes[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-outcomes-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-outcomes-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-outcomes-summary,.sway-ai-ki-outcomes-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-outcomes-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-outcomes-summary-grid>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-outcomes-summary-grid span,.sway-ai-ki-outcome-grid span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-outcomes-summary-grid strong{font-size:11px}" +
        ".sway-ai-ki-outcome-item{display:grid;gap:9px;padding:11px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-outcome-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-outcome-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-outcome-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-outcome-head span{font-size:9px;opacity:.58}" +
        ".sway-ai-ki-outcome-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-outcome-item>p{margin:0;font-size:10px;line-height:1.5}" +
        ".sway-ai-ki-outcome-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-outcome-grid>div{display:grid;gap:3px;padding-top:7px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-outcome-grid strong{font-size:9px;font-weight:600;line-height:1.4}" +
        ".sway-ai-ki-outcome-summary-text{white-space:pre-wrap}" +
        ".sway-ai-ki-outcome-observations{display:grid;gap:5px}" +
        ".sway-ai-ki-outcome-observation{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center;padding:6px 7px;border-radius:8px;background:rgba(1,82,244,.035);font-size:8px}" +
        ".sway-ai-ki-outcome-observation span,.sway-ai-ki-outcome-observation em{opacity:.58;font-style:normal}" +
        ".sway-ai-ki-outcome-actions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}" +
        "body.sway-dark-mode .sway-ai-ki-outcomes-summary-grid>div,body.sway-dark-mode .sway-ai-ki-outcome-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-outcome-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-outcome-grid>div{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-outcome-observation{background:rgba(119,193,252,.055)}" +
        "@media(max-width:680px){.sway-ai-ki-outcomes-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-outcome-head{display:grid;gap:6px}.sway-ai-ki-outcome-head em{width:fit-content}.sway-ai-ki-outcome-grid{grid-template-columns:1fr}}" +
        ".sway-ai-ki-acquisition{width:100%;margin:4px 0}" +
        ".sway-ai-ki-acquisition>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-ki-acquisition>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-ki-acquisition>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-ki-acquisition[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-acquisition-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-acquisition-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-acquisition-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-acquisition-item{display:grid;gap:9px;padding:11px;border:1px solid rgba(1,82,244,.1);border-radius:12px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-acquisition-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}" +
        ".sway-ai-ki-acquisition-head>div{display:grid;gap:3px;min-width:0}" +
        ".sway-ai-ki-acquisition-head strong{font-size:11px;line-height:1.35}" +
        ".sway-ai-ki-acquisition-head span{font-size:9px;opacity:.58}" +
        ".sway-ai-ki-acquisition-head em{padding:4px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}" +
        ".sway-ai-ki-acquisition-meta{display:flex;flex-wrap:wrap;gap:6px;font-size:8px;line-height:1.35;opacity:.62}" +
        ".sway-ai-ki-acquisition-form{display:grid;gap:9px;padding-top:5px;border-top:1px solid rgba(1,82,244,.08)}" +
        ".sway-ai-ki-acquisition-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
        ".sway-ai-ki-acquisition-form label{display:grid;gap:4px}" +
        ".sway-ai-ki-acquisition-form label>span{font-size:8px;opacity:.58}" +
        ".sway-ai-ki-acquisition-form input,.sway-ai-ki-acquisition-form select,.sway-ai-ki-acquisition-form textarea{width:100%;box-sizing:border-box;border:1px solid rgba(1,82,244,.12);border-radius:8px;padding:7px 8px;font:inherit;font-size:10px;background:rgba(255,255,255,.7);color:inherit;outline:none}" +
        ".sway-ai-ki-acquisition-form textarea{min-height:92px;resize:vertical;line-height:1.45}" +
        ".sway-ai-ki-acquisition-form input:focus,.sway-ai-ki-acquisition-form select:focus,.sway-ai-ki-acquisition-form textarea:focus{border-color:rgba(1,82,244,.42);box-shadow:0 0 0 2px rgba(1,82,244,.08)}" +
        ".sway-ai-ki-acquisition-wide{grid-column:1 / -1}" +
        ".sway-ai-ki-acquisition-draft{display:grid;gap:8px;padding-top:8px;border-top:1px solid rgba(1,82,244,.08)}" +
        "body.sway-dark-mode .sway-ai-ki-acquisition-item{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-acquisition-head em{background:rgba(119,193,252,.1);color:#78C3FF}" +
        "body.sway-dark-mode .sway-ai-ki-acquisition-form,body.sway-dark-mode .sway-ai-ki-acquisition-draft{border-top-color:rgba(119,193,252,.1)}" +
        "body.sway-dark-mode .sway-ai-ki-acquisition-form input,body.sway-dark-mode .sway-ai-ki-acquisition-form select,body.sway-dark-mode .sway-ai-ki-acquisition-form textarea{border-color:rgba(119,193,252,.14);background:#101A2C;color:#F3F7FC}" +
        "@media(max-width:680px){.sway-ai-ki-acquisition-head{display:grid;gap:6px}.sway-ai-ki-acquisition-head em{width:fit-content}.sway-ai-ki-acquisition-form-grid{grid-template-columns:1fr}.sway-ai-ki-acquisition-wide{grid-column:auto}}"
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
        "@media(max-width:680px){.sway-ai-ki-gap-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-gap-head{display:grid;gap:6px}.sway-ai-ki-gap-head em{width:fit-content}.sway-ai-ki-gap-grid{grid-template-columns:1fr}}" +
        "@media(max-width:680px){.sway-ai-ki-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sway-ai-ki-verification-head{display:grid;gap:6px}.sway-ai-ki-verification-head em{width:fit-content}}";
    document.head.appendChild(style);

    const observer = new MutationObserver(function () {
        if (document.getElementById("sway-ai-more-panel")) ensurePanel();
    });

    observer.observe(document.body, {childList: true, subtree: true});
    ensurePanel();
})();
