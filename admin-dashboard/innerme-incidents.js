(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const PANEL_ID = "sway-ai-knowledge-intelligence-bridge";
    const INTERVENTION_FUNCTION_URL = SUPABASE_URL + "/functions/v1/innerme-interventions";

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

    function headers() {
        return {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + token(),
            "Content-Type": "application/json"
        };
    }

    async function correlate() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/generate_innerme_operational_incidents",
            {
                method: "POST",
                headers: headers(),
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
                    : "Incident correlation failed."
            );
        }
        return Number(data || 0);
    }

    // Phase 29 uses the central intelligence runner for calibration-aware refreshes.
    async function refreshFullIntelligence() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/run_innerme_incident_intelligence",
            {
                method: "POST",
                headers: headers(),
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
                    : "Integrated InnerMe intelligence refresh failed."
            );
        }
        return Number(data || 0);
    }

    async function loadIncidents() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_operational_incidents" +
                "?select=id,incident_key,incident_type,severity,status,title,summary,categories,source_count,source_snapshot,correlation_reason,recommended_response,condition_fingerprint,first_detected_at,last_detected_at,acknowledged_at,resolved_at,ignored_at,created_at,updated_at" +
                "&order=last_detected_at.desc&limit=100",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load operational incidents."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function refreshIntelligence() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_incident_intelligence",
            {
                method: "POST",
                headers: headers(),
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
                    : "Incident intelligence refresh failed."
            );
        }
        return Number(data || 0);
    }

    async function loadIntelligence() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_intelligence" +
                "?select=incident_id,priority_score,priority_band,impact_score,urgency_score,dependency_score,dominant_risk,primary_dependency,decision_required,recommended_first_review,reasoning,evidence,updated_at" +
                "&order=priority_score.desc&limit=100",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident intelligence."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadRootAnalysis() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_root_analysis" +
                "?select=incident_id,analysis_status,confidence,leading_dependency_id,leading_factor,blocking_factor,evidence_summary,alternative_explanations,next_validation_step,method,condition_fingerprint,updated_at" +
                "&order=updated_at.desc&limit=100",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident dependency analysis."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadHypothesisTests() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_hypothesis_tests" +
                "?select=incident_id,dependency_id,support_score,contradiction_score,temporal_score,persistence_score,recurrence_score,validation_status,hypothesis,evidence,alternative_explanations,next_test,updated_at" +
                "&order=support_score.desc&limit=500",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident hypothesis tests."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadCounterfactuals() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_counterfactuals" +
                "?select=incident_id,dependency_id,hypothesis_test_id,current_priority,counterfactual_priority,estimated_priority_delta,residual_risk_band,intervention_class,proposed_intervention,expected_effect,expected_signal,reversibility,intervention_risk,decision_gate,confidence,assumptions,evidence,updated_at" +
                "&order=estimated_priority_delta.asc,counterfactual_priority.asc&limit=500",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident counterfactuals."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadInterventionSelections() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_intervention_selection" +
                "?select=id,incident_id,selected_option_id,selection_status,recommended_first_action,selection_rationale,sequence,alternatives,decision_gate,confidence,updated_at" +
                "&limit=100",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load intervention selections."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadInterventionExecutions() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_intervention_executions" +
                "?select=id,selection_id,option_id,incident_id,dependency_id,action_type,status,approval_required,approved_at,executed_by,execution_started_at,execution_completed_at,task_id,verification_status,verification_note,result_payload,error_message,condition_fingerprint,created_at,updated_at" +
                "&order=created_at.desc&limit=200",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load intervention executions."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadInterventionOutcomes() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_intervention_outcomes" +
                "?select=id,execution_id,incident_id,dependency_id,action_type,outcome_measurement_status,outcome_status,attribution,confidence,baseline_priority,expected_priority,observed_priority,priority_delta,expected_signal,observed_signal,incident_status_at_measurement,task_status_at_measurement,competing_interventions_count,condition_changed,measurement_due_at,measured_at,evidence,learning_candidate_id,updated_at" +
                "&order=updated_at.desc&limit=200",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load intervention outcomes."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function refreshAgentCoordination() {
        const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_agent_coordination", {
            method: "POST", headers: headers(), body: "{}"
        });
        const data = await response.json().catch(function () { return null; });
        if (!response.ok) throw new Error((data && (data.message || data.error || data.hint)) || "Agent coordination refresh failed.");
        return Number(data || 0);
    }

    async function loadAgentCoordinationRuns() {
        const response = await fetch(SUPABASE_URL + "/rest/v1/innerme_agent_coordination_runs?select=id,run_key,target_type,target_id,objective,rationale,coordination_mode,status,conflict_status,conflict_notes,agent_count,condition_fingerprint,approval_required,updated_at&target_type=eq.incident&order=updated_at.desc&limit=200", { method: "GET", headers: headers() });
        const data = await response.json().catch(function () { return []; });
        if (!response.ok) throw new Error("Unable to load agent coordination runs.");
        return Array.isArray(data) ? data : [];
    }

    async function loadAgentCoordinationAssignments() {
        const response = await fetch(SUPABASE_URL + "/rest/v1/innerme_agent_coordination_assignments?select=id,run_id,agent_id,assignment_role,sequence_rank,objective,expected_output,trust_stage,status,depends_on_assignment_id,handoff_required,updated_at&order=sequence_rank.asc&limit=500", { method: "GET", headers: headers() });
        const data = await response.json().catch(function () { return []; });
        if (!response.ok) throw new Error("Unable to load agent coordination assignments.");
        return Array.isArray(data) ? data : [];
    }

    async function loadAgentCoordinationHandoffs() {
        const response = await fetch(SUPABASE_URL + "/rest/v1/innerme_agent_coordination_handoffs?select=id,run_id,from_assignment_id,to_assignment_id,sequence_rank,status,handoff_contract,updated_at&order=sequence_rank.asc&limit=500", { method: "GET", headers: headers() });
        const data = await response.json().catch(function () { return []; });
        if (!response.ok) throw new Error("Unable to load agent coordination handoffs.");
        return Array.isArray(data) ? data : [];
    }

    async function loadInnerMeAgents() {
        const response = await fetch(SUPABASE_URL + "/rest/v1/innerme_agents?select=id,slug,name,trust_stage,status,permissions&order=name.asc&limit=50", { method: "GET", headers: headers() });
        const data = await response.json().catch(function () { return []; });
        if (!response.ok) throw new Error("Unable to load InnerMe agents.");
        return Array.isArray(data) ? data : [];
    }
    async function proposeLearningCandidate(outcomeId) {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/propose_innerme_intervention_learning_candidate",
            {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ p_outcome_id: outcomeId })
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Learning candidate creation failed."
            );
        }

        return Array.isArray(data) ? data[0] || null : data;
    }

    async function prepareInterventionExecution(selectionId) {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/prepare_innerme_intervention_execution",
            {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ p_selection_id: selectionId })
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to prepare intervention execution."
            );
        }

        return Array.isArray(data) ? data[0] || null : data;
    }

    async function reviewInterventionExecution(executionId, decision) {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/review_innerme_intervention_execution",
            {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({
                    p_execution_id: executionId,
                    p_decision: decision
                })
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Intervention execution review failed."
            );
        }

        return Array.isArray(data) ? data[0] || null : data;
    }

    async function callInterventionFunction(action, executionId) {
        const response = await fetch(INTERVENTION_FUNCTION_URL, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
                action: action,
                execution_id: executionId
            })
        });

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Intervention execution failed."
            );
        }

        return data;
    }

    async function loadInterventionOptions() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_intervention_options" +
                "?select=incident_id,counterfactual_id,dependency_id,selection_score,expected_priority_reduction,risk_score,reversibility_score,evidence_support_score,directness_score,sequence_score,sequence_rank,recommendation_status,conflict_status,action_statement,sequencing_reason,conflict_notes,decision_gate,updated_at" +
                "&order=incident_id,sequence_rank&limit=500",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load intervention options."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function refreshInterventionSelection() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_incident_intervention_selection",
            {
                method: "POST",
                headers: headers(),
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
                    : "Intervention selection refresh failed."
            );
        }

        return Number(data || 0);
    }

    async function refreshCounterfactuals() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_incident_counterfactuals",
            {
                method: "POST",
                headers: headers(),
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
                    : "Counterfactual analysis refresh failed."
            );
        }

        return Number(data || 0);
    }

    async function refreshHypothesisTests() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_incident_hypothesis_tests",
            {
                method: "POST",
                headers: headers(),
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
                    : "Hypothesis testing refresh failed."
            );
        }

        return Number(data || 0);
    }

    async function loadDependencies() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_incident_dependencies" +
                "?select=incident_id,dependency_rank,dependency_score,dependency_type,source_table,source_id,relationship,label,is_unresolved,evidence" +
                "&order=incident_id,dependency_rank&limit=500",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident dependency graph."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function refreshRootAnalysis() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_incident_root_analysis",
            {
                method: "POST",
                headers: headers(),
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
                    : "Dependency analysis refresh failed."
            );
        }

        return Number(data || 0);
    }

    async function loadEvents() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_operational_incident_events" +
                "?select=id,incident_id,event_type,severity,status,note,created_at" +
                "&order=created_at.desc&limit=200",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load incident history."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function review(id, status) {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/review_innerme_operational_incident",
            {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({
                    p_incident_id: id,
                    p_status: status
                })
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Incident review failed."
            );
        }

        return data;
    }

    function severityClass(severity) {
        return String(severity || "medium").replace(/[^a-z]/gi, "").toLowerCase();
    }

    function statusClass(status) {
        return String(status || "open").replace(/[^a-z]/gi, "").toLowerCase();
    }

    function formatDate(value) {
        if (!value) return "Not recorded";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? String(value)
            : date.toLocaleString();
    }

    function categoryLabel(categories) {
        return Array.isArray(categories) && categories.length
            ? categories.map(function (item) {
                return String(item || "").replace(/_/g, " ");
            }).join(" · ")
            : "operational";
    }

    function renderSourceSnapshot(snapshot) {
        const rows = Array.isArray(snapshot) ? snapshot : [];
        if (!rows.length) {
            return '<p class="sway-ai-incidents-muted">No source snapshot recorded.</p>';
        }

        return rows.slice(0, 20).map(function (source) {
            const table = String(source && source.source_table || "source");
            const id = String(source && source.source_id || "");
            const type = String(source && source.exception_type || "signal").replace(/_/g, " ");
            const extra = source && source.title ? " · " + String(source.title) : "";

            return (
                '<div class="sway-ai-incident-source">' +
                    '<span>' + esc(type) + extra + '</span>' +
                    '<small>' + esc(table) + (id ? " · " + esc(id) : "") + '</small>' +
                '</div>'
            );
        }).join("");
    }

    function renderEvents(events) {
        if (!events.length) {
            return '<p class="sway-ai-incidents-muted">No audit events recorded.</p>';
        }

        return events.slice(0, 12).map(function (event) {
            return (
                '<div class="sway-ai-incident-event">' +
                    '<div><strong>' + esc(event.event_type || "event") + '</strong><span>' + esc(event.status || "") + '</span></div>' +
                    '<small>' + esc(formatDate(event.created_at)) + '</small>' +
                    '<p>' + esc(event.note || "Incident state recorded.") + '</p>' +
                '</div>'
            );
        }).join("");
    }

    function render(panel, incidents, events, intelligence, analyses, dependencies, hypotheses, counterfactuals, selections, interventionOptions, executions, outcomes, coordinationRuns, coordinationAssignments, coordinationHandoffs, agents, generated) {
        const active = incidents.filter(function (item) {
            return ["open", "acknowledged"].includes(String(item.status));
        });
        const counts = incidents.reduce(function (result, item) {
            const severity = String(item.severity || "medium");
            const status = String(item.status || "open");
            result.total += 1;
            result[severity] = (result[severity] || 0) + 1;
            if (["open", "acknowledged"].includes(status)) {
                result.active += 1;
            }
            return result;
        }, { total: 0, active: 0 });

        const eventMap = new Map();
        events.forEach(function (event) {
            const key = String(event.incident_id || "");
            if (!eventMap.has(key)) eventMap.set(key, []);
            eventMap.get(key).push(event);
        });

        const intelligenceMap = new Map();
        intelligence.forEach(function (item) {
            intelligenceMap.set(String(item.incident_id || ""), item);
        });

        const intelligenceCounts = intelligence.reduce(function (result, item) {
            const band = String(item.priority_band || "low");
            result.total += 1;
            result[band] = (result[band] || 0) + 1;
            return result;
        }, { total: 0, critical: 0, high: 0, medium: 0, low: 0 });

        const analysisMap = new Map();
        analyses.forEach(function (item) {
            analysisMap.set(String(item.incident_id || ""), item);
        });

        const dependencyMap = new Map();
        dependencies.forEach(function (item) {
            const key = String(item.incident_id || "");
            if (!dependencyMap.has(key)) dependencyMap.set(key, []);
            dependencyMap.get(key).push(item);
        });

        const hypothesisMap = new Map();
        hypotheses.forEach(function (item) {
            const key = String(item.incident_id || "");
            if (!hypothesisMap.has(key)) hypothesisMap.set(key, []);
            hypothesisMap.get(key).push(item);
        });

        const counterfactualMap = new Map();
        counterfactuals.forEach(function (item) {
            const key = String(item.incident_id || "");
            if (!counterfactualMap.has(key)) counterfactualMap.set(key, []);
            counterfactualMap.get(key).push(item);
        });

        const interventionSelectionMap = new Map();
        selections.forEach(function (item) {
            interventionSelectionMap.set(String(item.incident_id || ""), item);
        });

        const interventionOptionsMap = new Map();
        interventionOptions.forEach(function (item) {
            const key = String(item.incident_id || "");
            if (!interventionOptionsMap.has(key)) interventionOptionsMap.set(key, []);
            interventionOptionsMap.get(key).push(item);
        });

        const executionMap = new Map();
        executions.forEach(function (item) {
            const key = String(item.incident_id || "");
            if (!executionMap.has(key)) executionMap.set(key, []);
            executionMap.get(key).push(item);
        });

        const outcomeMap = new Map();
        outcomes.forEach(function (item) {
            outcomeMap.set(String(item.execution_id || ""), item);
        });

        const coordinationMap = new Map();
        coordinationRuns.forEach(function (run) {
            coordinationMap.set(String(run.target_id || ""), run);
        });
        const assignmentsMap = new Map();
        coordinationAssignments.forEach(function (item) {
            const key = String(item.run_id || "");
            if (!assignmentsMap.has(key)) assignmentsMap.set(key, []);
            assignmentsMap.get(key).push(item);
        });
        const handoffsMap = new Map();
        coordinationHandoffs.forEach(function (item) {
            const key = String(item.run_id || "");
            if (!handoffsMap.has(key)) handoffsMap.set(key, []);
            handoffsMap.get(key).push(item);
        });
        const agentMap = new Map();
        agents.forEach(function (agent) {
            agentMap.set(String(agent.id || ""), agent);
        });

        const summary = panel.querySelector("[data-im-incident-summary]");
        summary.innerHTML =
            '<div><span>Active</span><strong>' + esc(counts.active) + '</strong></div>' +
            '<div><span>Critical</span><strong>' + esc(counts.critical || 0) + '</strong></div>' +
            '<div><span>High</span><strong>' + esc(counts.high || 0) + '</strong></div>' +
            '<div><span>Intelligent</span><strong>' + esc(intelligenceCounts.total) + '</strong></div>' +
            '<div><span>Coordinated</span><strong>' + esc(coordinationRuns.length) + '</strong></div>' +
            '<div><span>Total</span><strong>' + esc(counts.total) + '</strong></div>';

        const results = panel.querySelector("[data-im-incidents]");
        const ordered = incidents.slice().sort(function (a, b) {
            const aActive = ["open", "acknowledged"].includes(String(a.status));
            const bActive = ["open", "acknowledged"].includes(String(b.status));
            if (aActive !== bActive) return aActive ? -1 : 1;
            const aInfo = intelligenceMap.get(String(a.id)) || {};
            const bInfo = intelligenceMap.get(String(b.id)) || {};
            const aScore = Number(aInfo.priority_score || 0);
            const bScore = Number(bInfo.priority_score || 0);
            if (aScore !== bScore) return bScore - aScore;
            return new Date(b.last_detected_at || b.updated_at || 0) - new Date(a.last_detected_at || a.updated_at || 0);
        });

        if (!ordered.length) {
            results.innerHTML =
                '<p class="sway-ai-ki-good">No operational incidents have been recorded. Individual exception monitoring remains separate and unchanged.</p>';
        } else {
            results.innerHTML =
                (active.length
                    ? '<div class="sway-ai-incident-group-title">Active incidents</div>'
                    : '') +
                ordered.map(function (incident) {
                const status = String(incident.status || "open");
                const isActive = ["open", "acknowledged"].includes(status);
                const info = intelligenceMap.get(String(incident.id)) || null;
                const analysis = analysisMap.get(String(incident.id)) || null;
                const graph = dependencyMap.get(String(incident.id)) || [];
                const hypotheses = hypothesisMap.get(String(incident.id)) || [];
                const counterfactuals = counterfactualMap.get(String(incident.id)) || [];
                const selection = interventionSelectionMap.get(String(incident.id)) || null;
                const optionList = interventionOptionsMap.get(String(incident.id)) || [];
                const executionList = executionMap.get(String(incident.id)) || [];
                const eventHistory = eventMap.get(String(incident.id)) || [];
                const dependencyHtml = graph.length
                    ? '<div class="sway-ai-incident-dependencies">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Dependency chain</strong><span>' + esc(String(graph.length)) + ' linked record(s)</span></div>' +
                        graph.slice(0, 6).map(function (dependency) {
                            return '<div class="sway-ai-incident-dependency-row">' +
                                '<span><strong>#' + esc(dependency.dependency_rank) + '</strong> ' + esc(dependency.label || dependency.relationship || "Dependency") + '</span>' +
                                '<small>' + esc(String(dependency.dependency_score || 0) + '/100 · ' + (dependency.is_unresolved ? "unresolved" : "resolved")) + '</small>' +
                            '</div>';
                        }).join("") +
                      '</div>'
                    : '';
                const hypothesisHtml = hypotheses.length
                    ? '<div class="sway-ai-incident-hypotheses">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Hypothesis validation</strong><span>' + esc(String(hypotheses.length)) + ' test(s)</span></div>' +
                        hypotheses.slice(0, 4).map(function (test) {
                            return '<div class="sway-ai-incident-hypothesis-row">' +
                                '<div class="sway-ai-incident-hypothesis-head"><strong>' + esc(test.validation_status || "inconclusive") + '</strong><span>' + esc(String(test.support_score || 0) + '/100 support · ' + String(test.contradiction_score || 0) + '/100 contradiction') + '</span></div>' +
                                '<p>' + esc(test.hypothesis || "") + '</p>' +
                                '<small>Next test: ' + esc(test.next_test || "") + '</small>' +
                            '</div>';
                        }).join("") +
                      '</div>'
                    : '';
                const counterfactualHtml = counterfactuals.length
                    ? '<div class="sway-ai-incident-counterfactuals">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Counterfactual intervention</strong><span>estimated effect only</span></div>' +
                        counterfactuals.slice(0, 3).map(function (cf) {
                            const delta = Number(cf.estimated_priority_delta || 0);
                            const direction = delta < 0 ? 'lower' : delta > 0 ? 'higher' : 'unchanged';
                            return '<div class="sway-ai-incident-counterfactual-row">' +
                                '<div class="sway-ai-incident-hypothesis-head"><strong>' + esc(direction) + '</strong><span>' + esc(String(cf.current_priority || 0) + ' → ' + String(cf.counterfactual_priority || 0) + ' priority') + '</span></div>' +
                                '<p><strong>Intervention:</strong> ' + esc(cf.proposed_intervention || "") + '</p>' +
                                '<p><strong>Expected signal:</strong> ' + esc(cf.expected_signal || "") + '</p>' +
                                '<small>' + esc((cf.confidence || "low") + ' confidence · ' + (cf.residual_risk_band || "low") + ' residual risk · ' + (cf.reversibility || "Review required")) + '</small>' +
                                '<small>Gate: ' + esc(cf.decision_gate || "") + '</small>' +
                            '</div>';
                        }).join("") +
                      '</div>'
                    : '';
                const currentExecution = selection
                    ? executionList.find(function (item) {
                        return String(item.selection_id || "") === String(selection.id || "");
                    }) || null
                    : null;
                const currentOutcome = currentExecution
                    ? outcomeMap.get(String(currentExecution.id)) || null
                    : null;
                const coordinationRun = coordinationMap.get(String(incident.id)) || null;
                const coordinationAssignments = coordinationRun
                    ? (assignmentsMap.get(String(coordinationRun.id)) || [])
                    : [];
                const coordinationHandoffs = coordinationRun
                    ? (handoffsMap.get(String(coordinationRun.id)) || [])
                    : [];
                const executionHtml =
                    selection && selection.selection_status === "selected"
                        ? '<div class="sway-ai-incident-execution">' +
                            '<div class="sway-ai-incident-intelligence-head"><strong>Controlled execution</strong><span>' + esc(currentExecution ? (currentExecution.status || "proposed") : "not prepared") + '</span></div>' +
                            (
                                currentExecution
                                    ? '<p><strong>Verification:</strong> ' + esc(currentExecution.verification_status || "pending") + ' · ' + esc(currentExecution.verification_note || "Awaiting execution.") + '</p>' +
                                      (currentExecution.task_id ? '<p><strong>Task:</strong> ' + esc(currentExecution.task_id) + '</p>' : '') +
                                      (currentExecution.error_message ? '<p><strong>Error:</strong> ' + esc(currentExecution.error_message) + '</p>' : '') +
                                      (
                                          currentExecution.status === "proposed"
                                              ? '<div class="sway-ai-incident-execution-actions">' +
                                                  '<button type="button" class="sway-ai-knowledge-test-button" data-im-execution-action="approve" data-im-execution-id="' + esc(currentExecution.id) + '">Approve execution</button>' +
                                                  '<button type="button" class="sway-ai-knowledge-test-button" data-im-execution-action="cancel" data-im-execution-id="' + esc(currentExecution.id) + '">Cancel</button>' +
                                                '</div>'
                                              : currentExecution.status === "approved"
                                                  ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-execution-action="execute" data-im-execution-id="' + esc(currentExecution.id) + '">Execute approved intervention</button>'
                                                  : currentExecution.status === "succeeded"
                                                      ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-execution-action="verify" data-im-execution-id="' + esc(currentExecution.id) + '">Re-verify</button>'
                                                      : ''
                                      )
                                    : '<p><strong>Gate:</strong> The intervention must be prepared and explicitly approved before execution.</p>' +
                                      '<button type="button" class="sway-ai-knowledge-test-button" data-im-execution-action="prepare" data-im-selection-id="' + esc(selection.id || "") + '">Prepare execution</button>'
                            ) +
                          '</div>'
                        : '';

                const outcomeHtml = currentOutcome
                    ? '<div class="sway-ai-incident-outcome">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Outcome verification</strong><span>' + esc(currentOutcome.outcome_measurement_status || "pending") + ' · ' + esc(currentOutcome.outcome_status || "pending") + '</span></div>' +
                        '<p><strong>Result:</strong> ' + esc(
                            currentOutcome.baseline_priority == null
                                ? "Baseline unavailable."
                                : String(currentOutcome.baseline_priority) + '/100 → ' +
                                  (currentOutcome.observed_priority == null ? "not measured" : String(currentOutcome.observed_priority) + '/100')
                        ) + '</p>' +
                        '<p><strong>Observed signal:</strong> ' + esc(currentOutcome.observed_signal || "") + '</p>' +
                        '<p><strong>Attribution:</strong> ' + esc(currentOutcome.attribution || "unproven") + ' · ' + esc(currentOutcome.confidence || "low") + ' confidence</p>' +
                        '<small>' + esc(
                            currentOutcome.measured_at
                                ? "Measured " + currentOutcome.measured_at
                                : "Measurement due " + currentOutcome.measurement_due_at
                        ) + '</small>' +
                        (
                            currentOutcome.outcome_status === "improved" && !currentOutcome.learning_candidate_id
                                ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-outcome-action="learn" data-im-outcome-id="' + esc(currentOutcome.id) + '">Create learning candidate</button>'
                                : currentOutcome.learning_candidate_id
                                    ? '<small>Learning candidate created: ' + esc(currentOutcome.learning_candidate_id) + '</small>'
                                    : ''
                        ) +
                      '</div>'
                    : '';
                const coordinationHtml = coordinationRun
                    ? '<div class="sway-ai-incident-coordination">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Agent coordination</strong><span>' +
                            esc(coordinationRun.coordination_mode || "sequential") + ' · ' +
                            esc(coordinationRun.status || "proposed") +
                        '</span></div>' +
                        '<p><strong>Team:</strong> ' + esc(String(coordinationRun.agent_count || coordinationAssignments.length)) +
                            ' agent(s) · ' + esc(coordinationRun.conflict_status || "none") + '</p>' +
                        '<div class="sway-ai-incident-agent-list">' +
                            coordinationAssignments.slice().sort(function (a, b) {
                                return Number(a.sequence_rank || 0) - Number(b.sequence_rank || 0);
                            }).map(function (assignment) {
                                const agent = agentMap.get(String(assignment.agent_id || "")) || {};
                                return '<div class="sway-ai-incident-agent-row">' +
                                    '<div><strong>#' + esc(assignment.sequence_rank) + ' · ' + esc(assignment.assignment_role || "specialist") + '</strong><span>' +
                                        esc(agent.name || "InnerMe agent") + '</span></div>' +
                                    '<small>Trust ' + esc(assignment.trust_stage || agent.trust_stage || 1) + ' · ' +
                                        esc(assignment.status || "pending") + '</small>' +
                                '</div>';
                            }).join("") +
                        '</div>' +
                        '<small>' + esc(String(coordinationHandoffs.length) +
                            " controlled handoff(s); authority and credentials are not transferred between agents.") + '</small>' +
                      '</div>'
                    : '';

                const interventionHtml = selection
                    ? '<div class="sway-ai-incident-intervention-selection">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Recommended intervention order</strong><span>' + esc(selection.confidence || "low") + ' confidence · ' + esc(selection.selection_status || "do_not_intervene") + '</span></div>' +
                        '<p><strong>First action:</strong> ' + esc(selection.recommended_first_action || "") + '</p>' +
                        '<p><strong>Rationale:</strong> ' + esc(selection.selection_rationale || "") + '</p>' +
                        '<div class="sway-ai-incident-intervention-sequence">' +
                            optionList.slice(0, 4).map(function (option) {
                                return '<div class="sway-ai-incident-intervention-option">' +
                                    '<div class="sway-ai-incident-hypothesis-head"><strong>#' + esc(option.sequence_rank || "") + ' · ' + esc(option.recommendation_status || "deferred") + '</strong><span>' + esc(String(option.selection_score || 0) + '/100 · reduce ' + String(option.expected_priority_reduction || 0)) + '</span></div>' +
                                    '<p>' + esc(option.action_statement || "") + '</p>' +
                                    '<small>' + esc(
                                        (option.conflict_status || "none") +
                                        ' · risk ' + String(option.risk_score || 0) +
                                        ' · reversible ' + String(option.reversibility_score || 0) +
                                        ' · adaptive ' + (
                                            (option.evidence && option.evidence.selection_components &&
                                                option.evidence.selection_components.adaptive_adjustment != null)
                                                ? ((Number(option.evidence.selection_components.adaptive_adjustment) > 0 ? "+" : "") +
                                                   String(option.evidence.selection_components.adaptive_adjustment))
                                                : "0"
                                        )
                                    ) + '</small>' +
                                '</div>';
                            }).join("") +
                        '</div>' +
                        '<small>Gate: ' + esc(selection.decision_gate || "Administrative validation required.") + '</small>' +
                      '</div>'
                    : '';
                const analysisHtml = analysis
                    ? '<div class="sway-ai-incident-root-analysis">' +
                        '<div class="sway-ai-incident-intelligence-head"><strong>Leading-factor analysis</strong><span>' + esc(analysis.confidence || "low") + ' confidence · ' + esc(analysis.analysis_status || "active") + '</span></div>' +
                        '<p><strong>Leading factor:</strong> ' + esc(analysis.leading_factor || "") + '</p>' +
                        '<p><strong>Blocking factor:</strong> ' + esc(analysis.blocking_factor || "") + '</p>' +
                        '<p><strong>Evidence:</strong> ' + esc(analysis.evidence_summary || "") + '</p>' +
                        '<p><strong>Next validation:</strong> ' + esc(analysis.next_validation_step || "") + '</p>' +
                      '</div>'
                    : '<div class="sway-ai-incident-root-analysis sway-ai-incidents-muted">No dependency analysis is currently available.</div>';
                const intelligenceHtml = info
                    ? '<div class="sway-ai-incident-intelligence">' +
                        '<div class="sway-ai-incident-intelligence-head">' +
                            '<strong>' + esc(String(info.priority_score || 0) + '/100') + '</strong>' +
                            '<span>' + esc(info.priority_band || "low") + ' priority · ' + esc(info.dominant_risk || "Operational continuity") + '</span>' +
                        '</div>' +
                        '<div class="sway-ai-incident-score-grid">' +
                            '<div><span>Impact</span><strong>' + esc(info.impact_score || 0) + '</strong></div>' +
                            '<div><span>Urgency</span><strong>' + esc(info.urgency_score || 0) + '</strong></div>' +
                            '<div><span>Dependency</span><strong>' + esc(info.dependency_score || 0) + '</strong></div>' +
                        '</div>' +
                        '<p><strong>Primary dependency:</strong> ' + esc(info.primary_dependency || "") + '</p>' +
                        '<p><strong>First review:</strong> ' + esc(info.recommended_first_review || "") + '</p>' +
                        '<p><strong>Decision required:</strong> ' + esc(info.decision_required || "") + '</p>' +
                      '</div>'
                    : '<div class="sway-ai-incident-intelligence sway-ai-incidents-muted">No intelligence assessment is currently available.</div>';
                const acknowledgementAction =
                    status === "open"
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="acknowledged" data-im-incident-id="' + esc(incident.id) + '">Acknowledge</button>'
                        : "";
                const resolveAction =
                    isActive
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="resolved" data-im-incident-id="' + esc(incident.id) + '">Resolve</button>'
                        : "";
                const reopenAction =
                    !isActive
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="open" data-im-incident-id="' + esc(incident.id) + '">Reopen</button>'
                        : "";

                return (
                    '<article class="sway-ai-incident-card">' +
                        '<div class="sway-ai-incident-head">' +
                            '<div><strong class="sway-ai-incident-pill ' + severityClass(incident.severity) + '">' + esc(incident.severity || "medium") + '</strong>' +
                            '<span>' + esc(status.replace(/_/g, " ")) + ' · ' + esc(categoryLabel(incident.categories)) + '</span></div>' +
                            '<small>' + esc(String(incident.source_count || 0)) + ' sources</small>' +
                        '</div>' +
                        '<h4>' + esc(incident.title || "Operational incident") + '</h4>' +
                        '<p>' + esc(incident.summary || "") + '</p>' +
                        intelligenceHtml +
                        analysisHtml +
                        hypothesisHtml +
                        counterfactualHtml +
                        interventionHtml +
                        executionHtml +
                        outcomeHtml +
                        coordinationHtml +
                        dependencyHtml +
                        '<div class="sway-ai-incident-reason"><strong>Why this is correlated</strong><p>' + esc(incident.correlation_reason || "") + '</p></div>' +
                        '<div class="sway-ai-incident-reason"><strong>Recommended response</strong><p>' + esc(incident.recommended_response || "") + '</p></div>' +
                        '<details class="sway-ai-incident-detail">' +
                            '<summary>Sources and audit history</summary>' +
                            '<div class="sway-ai-incident-sources">' + renderSourceSnapshot(incident.source_snapshot) + '</div>' +
                            '<div class="sway-ai-incident-events">' + renderEvents(eventHistory) + '</div>' +
                        '</details>' +
                        '<div class="sway-ai-incident-meta">' +
                            '<span>First detected: ' + esc(formatDate(incident.first_detected_at)) + '</span>' +
                            '<span>Last detected: ' + esc(formatDate(incident.last_detected_at)) + '</span>' +
                        '</div>' +
                        '<div class="sway-ai-incident-actions">' +
                            acknowledgementAction + resolveAction + reopenAction +
                        '</div>' +
                    '</article>'
                );
            }).join("") +
                (incidents.some(function (item) {
                    return ["resolved", "ignored"].includes(String(item.status));
                })
                    ? '<div class="sway-ai-incident-group-title sway-ai-incident-history-title">Recent incident history</div>'
                    : '');
        }

        const generatedLabel = panel.querySelector("[data-im-incident-generated]");
        generatedLabel.textContent =
            generated > 0
                ? generated + " records processed across the integrated incident, outcome, strategy, trust, coordination and predictive intelligence pipeline."
                : "Integrated intelligence refresh completed. No new calibration or signal records were required.";
    }

    function injectStyles() {
        if (document.getElementById("sway-ai-incidents-styles")) return;

        const style = document.createElement("style");
        style.id = "sway-ai-incidents-styles";
        style.textContent =
            ".sway-ai-incidents{width:100%;margin:4px 0}" +
            ".sway-ai-incidents>summary{padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none;font-weight:700}" +
            ".sway-ai-incidents>summary::-webkit-details-marker{display:none}" +
            ".sway-ai-incidents-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px 10px}" +
            ".sway-ai-incidents-top>span{font-size:11px;line-height:1.45;opacity:.68;max-width:760px}" +
            ".sway-ai-incident-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;padding:0 10px 8px}" +
            ".sway-ai-incident-summary>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
            ".sway-ai-incident-summary span{font-size:8px;opacity:.58}.sway-ai-incident-summary strong{font-size:12px}" +
            ".sway-ai-incident-generated{margin:0;padding:0 10px 9px;font-size:9px;opacity:.58}" +
            ".sway-ai-incidents-list{display:grid;gap:8px;padding:0 10px 10px}.sway-ai-incident-group-title{padding:3px 0 1px;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;opacity:.55}.sway-ai-incident-history-title{margin-top:5px}" +
            ".sway-ai-incident-card{display:grid;gap:6px;padding:10px;border:1px solid rgba(1,82,244,.09);border-radius:10px;background:rgba(1,82,244,.018)}" +
            ".sway-ai-incident-head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
            ".sway-ai-incident-head>div{display:flex;align-items:center;gap:7px;min-width:0}" +
            ".sway-ai-incident-head span,.sway-ai-incident-head small{font-size:8px;opacity:.58}" +
            ".sway-ai-incident-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:800;text-transform:capitalize}" +
            ".sway-ai-incident-pill.critical,.sway-ai-incident-pill.high{background:rgba(190,52,52,.12);color:#B42323}" +
            ".sway-ai-incident-pill.medium{background:rgba(247,201,120,.14);color:#9A6700}" +
            ".sway-ai-incident-pill.low{background:rgba(1,82,244,.08);color:#0152F4}" +
            ".sway-ai-incident-card h4{margin:0;font-size:11px}.sway-ai-incident-card>p{margin:0;font-size:9px;line-height:1.48}.sway-ai-incident-intelligence{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.08);border-radius:9px;background:rgba(1,82,244,.02)}.sway-ai-incident-intelligence-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.sway-ai-incident-intelligence-head strong{font-size:13px}.sway-ai-incident-intelligence-head span{font-size:8px;opacity:.62}.sway-ai-incident-score-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.sway-ai-incident-score-grid>div{display:grid;gap:2px}.sway-ai-incident-score-grid span{font-size:7px;opacity:.55;text-transform:uppercase;letter-spacing:.04em}.sway-ai-incident-score-grid strong{font-size:10px}.sway-ai-incident-intelligence p{margin:0;font-size:8px;line-height:1.45}.sway-ai-incident-intelligence p strong{font-weight:700}.sway-ai-incident-root-analysis,.sway-ai-incident-dependencies{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.08);border-radius:9px;background:rgba(1,82,244,.018)}.sway-ai-incident-root-analysis p{margin:0;font-size:8px;line-height:1.45}.sway-ai-incident-intervention-option small{font-size:7px;opacity:.65}
.sway-ai-incident-coordination{display:grid;gap:6px;margin-top:6px;padding:8px;border:1px solid rgba(1,82,244,.10);border-radius:9px;background:rgba(1,82,244,.018)}
.sway-ai-incident-agent-list{display:grid;gap:5px}
.sway-ai-incident-agent-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(1,82,244,.06)}
.sway-ai-incident-agent-row>div{display:grid;gap:2px}.sway-ai-incident-agent-row strong{font-size:8px;text-transform:capitalize}.sway-ai-incident-agent-row span,.sway-ai-incident-agent-row small{font-size:7px;opacity:.62}
body.sway-dark-mode .sway-ai-incident-coordination{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.025)}
.sway-ai-incident-outcome{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.10);border-radius:9px;background:rgba(1,82,244,.022)}
.sway-ai-incident-outcome p{margin:0;font-size:8px;line-height:1.4}.sway-ai-incident-outcome small{font-size:7px;opacity:.62}
body.sway-dark-mode .sway-ai-incident-outcome{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}
.sway-ai-incident-execution{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.12);border-radius:9px;background:rgba(1,82,244,.03)}
.sway-ai-incident-execution p{margin:0;font-size:8px;line-height:1.4}.sway-ai-incident-execution-actions{display:flex;gap:6px;flex-wrap:wrap}
body.sway-dark-mode .sway-ai-incident-execution{border-color:rgba(119,193,252,.13);background:rgba(119,193,252,.04)}
.sway-ai-incident-intervention-selection{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.11);border-radius:9px;background:rgba(1,82,244,.026)}
.sway-ai-incident-intervention-sequence{display:grid;gap:5px}
.sway-ai-incident-intervention-option{padding:5px 0;border-top:1px solid rgba(1,82,244,.06)}
.sway-ai-incident-intervention-option:first-child{border-top:0}
.sway-ai-incident-intervention-option p{margin:3px 0;font-size:8px;line-height:1.4}
.sway-ai-incident-intervention-option small,.sway-ai-incident-intervention-selection>small{display:block;font-size:7px;opacity:.62}
body.sway-dark-mode .sway-ai-incident-intervention-selection{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}
.sway-ai-incident-counterfactuals{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.08);border-radius:9px;background:rgba(1,82,244,.018)}.sway-ai-incident-counterfactual-row{padding:5px 0;border-top:1px solid rgba(1,82,244,.06)}.sway-ai-incident-counterfactual-row:first-of-type{border-top:0}.sway-ai-incident-counterfactual-row p{margin:3px 0;font-size:8px;line-height:1.4}.sway-ai-incident-counterfactual-row small{display:block;font-size:7px;opacity:.6}body.sway-dark-mode .sway-ai-incident-counterfactuals{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}.sway-ai-incident-hypotheses{display:grid;gap:6px;padding:8px;border:1px solid rgba(1,82,244,.08);border-radius:9px;background:rgba(1,82,244,.018)}.sway-ai-incident-hypothesis-row{padding:5px 0;border-top:1px solid rgba(1,82,244,.06)}.sway-ai-incident-hypothesis-row:first-of-type{border-top:0}.sway-ai-incident-hypothesis-head{display:flex;justify-content:space-between;gap:8px}.sway-ai-incident-hypothesis-head strong{font-size:8px;text-transform:capitalize}.sway-ai-incident-hypothesis-head span,.sway-ai-incident-hypothesis-row small{font-size:7px;opacity:.6}.sway-ai-incident-hypothesis-row p{margin:3px 0;font-size:8px;line-height:1.4}body.sway-dark-mode .sway-ai-incident-hypotheses{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}.sway-ai-incident-dependency-row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(1,82,244,.06)}.sway-ai-incident-dependency-row:first-of-type{border-top:0}.sway-ai-incident-dependency-row span{font-size:8px;line-height:1.4}.sway-ai-incident-dependency-row small{font-size:7px;opacity:.55;white-space:nowrap}body.sway-dark-mode .sway-ai-incident-root-analysis,body.sway-dark-mode .sway-ai-incident-dependencies{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}body.sway-dark-mode .sway-ai-incident-intelligence{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.035)}@media(max-width:700px){.sway-ai-incident-score-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}" +
            ".sway-ai-incident-reason{display:grid;gap:2px}.sway-ai-incident-reason strong{font-size:8px;text-transform:uppercase;letter-spacing:.04em;opacity:.58}" +
            ".sway-ai-incident-reason p{margin:0;font-size:9px;line-height:1.45}" +
            ".sway-ai-incident-detail{border-top:1px solid rgba(1,82,244,.08);padding-top:6px}.sway-ai-incident-detail>summary{font-size:8px;cursor:pointer;opacity:.72}" +
            ".sway-ai-incident-sources,.sway-ai-incident-events{display:grid;gap:5px;padding-top:7px}" +
            ".sway-ai-incident-source,.sway-ai-incident-event{display:grid;gap:2px;padding:7px;border:1px solid rgba(1,82,244,.07);border-radius:8px;background:rgba(1,82,244,.015)}" +
            ".sway-ai-incident-source span,.sway-ai-incident-event p{font-size:8px;line-height:1.4}.sway-ai-incident-source small,.sway-ai-incident-event small{font-size:7px;opacity:.55;overflow-wrap:anywhere}" +
            ".sway-ai-incident-event div{display:flex;justify-content:space-between;gap:8px}.sway-ai-incident-event div strong,.sway-ai-incident-event div span{font-size:8px;text-transform:capitalize}.sway-ai-incident-event p{margin:0}" +
            ".sway-ai-incident-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:7px;opacity:.52}" +
            ".sway-ai-incident-actions{display:flex;flex-wrap:wrap;gap:6px}" +
            ".sway-ai-incidents-muted{margin:0;padding:6px 0;font-size:9px;opacity:.58}" +
            "body.sway-dark-mode .sway-ai-incident-summary>div,body.sway-dark-mode .sway-ai-incident-card,body.sway-dark-mode .sway-ai-incident-source,body.sway-dark-mode .sway-ai-incident-event{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
            "body.sway-dark-mode .sway-ai-incident-pill.critical,body.sway-dark-mode .sway-ai-incident-pill.high{background:rgba(190,52,52,.17);color:#FFB0B0}" +
            "body.sway-dark-mode .sway-ai-incident-pill.medium{background:rgba(247,201,120,.12);color:#FFD990}" +
            "body.sway-dark-mode .sway-ai-incident-pill.low{background:rgba(119,193,252,.09);color:#78C3FF}" +
            "@media(max-width:700px){.sway-ai-incidents-top{display:grid}.sway-ai-incident-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}";
        document.head.appendChild(style);
    }

    function boot() {
        injectStyles();
        const bridge = document.getElementById(PANEL_ID);
        if (!bridge) {
            window.setTimeout(boot, 450);
            return;
        }

        if (bridge.querySelector("[data-sway-incident-panel]")) return;

        bridge.insertAdjacentHTML(
            "beforeend",
            '<details class="sway-ai-incidents" data-sway-incident-panel>' +
                '<summary>Operational incidents</summary>' +
                '<div class="sway-ai-incidents-top">' +
                    '<span>Correlates exceptions, prioritises incidents and traces their live workspace dependencies. Analysis is deterministic, source-backed and advisory. It does not mutate leads, clients, tasks, projects, invoices or InnerMe action state.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-refresh>Run incident analysis</button>' +
                '</div>' +
                '<div class="sway-ai-incident-summary" data-im-incident-summary></div>' +
                '<p class="sway-ai-incident-generated" data-im-incident-generated>Not scanned yet.</p>' +
                '<div class="sway-ai-incidents-list" data-im-incidents><p class="sway-ai-incidents-muted">Loading incidents…</p></div>' +
            '</details>'
        );

        const panel = bridge.querySelector("[data-sway-incident-panel]");
        const refreshButton = panel.querySelector("[data-im-incident-refresh]");

        async function refresh() {
            refreshButton.disabled = true;
            refreshButton.textContent = "Analysing…";
            try {
                const generated = await refreshFullIntelligence();
                const incidents = await loadIncidents();
                const events = await loadEvents();
                const intelligence = await loadIntelligence();
                const analyses = await loadRootAnalysis();
                const dependencies = await loadDependencies();
                const hypotheses = await loadHypothesisTests();
                const counterfactuals = await loadCounterfactuals();
                const selections = await loadInterventionSelections();
                const interventionOptions = await loadInterventionOptions();
                const executions = await loadInterventionExecutions();
                const outcomes = await loadInterventionOutcomes();
                const coordinationRuns = await loadAgentCoordinationRuns();
                const coordinationAssignments = await loadAgentCoordinationAssignments();
                const coordinationHandoffs = await loadAgentCoordinationHandoffs();
                const agents = await loadInnerMeAgents();
                render(panel, incidents, events, intelligence, analyses, dependencies, hypotheses, counterfactuals, selections, interventionOptions, executions, outcomes, coordinationRuns, coordinationAssignments, coordinationHandoffs, agents, generated);
            } catch (error) {
                panel.querySelector("[data-im-incidents]").innerHTML =
                    '<p class="sway-ai-ki-error">' + esc(error.message || "Incident correlation failed.") + "</p>";
            } finally {
                refreshButton.disabled = false;
                refreshButton.textContent = "Run incident analysis";
            }
        }

        panel.addEventListener("click", async function (event) {
            const outcomeButton = event.target.closest("[data-im-outcome-action]");
            if (outcomeButton) {
                const action = String(outcomeButton.getAttribute("data-im-outcome-action") || "");
                const outcomeId = String(outcomeButton.getAttribute("data-im-outcome-id") || "");
                if (action !== "learn" || !outcomeId) return;
                outcomeButton.disabled = true;
                try {
                    if (!window.confirm("Create a governed learning candidate from this measured intervention outcome? It will remain subject to verification and regression review.")) {
                        outcomeButton.disabled = false;
                        return;
                    }
                    await proposeLearningCandidate(outcomeId);
                    await refresh();
                } catch (error) {
                    window.alert(error.message || "Learning candidate creation failed.");
                    outcomeButton.disabled = false;
                }
                return;
            }

            const executionButton = event.target.closest("[data-im-execution-action]");
            if (executionButton) {
                const action = String(executionButton.getAttribute("data-im-execution-action") || "");
                const executionId = String(executionButton.getAttribute("data-im-execution-id") || "");
                const selectionId = String(executionButton.getAttribute("data-im-selection-id") || "");

                executionButton.disabled = true;
                try {
                    if (action === "prepare") {
                        await prepareInterventionExecution(selectionId);
                    } else if (action === "approve") {
                        if (!window.confirm("Approve this InnerMe intervention for controlled task creation?")) {
                            executionButton.disabled = false;
                            return;
                        }
                        await reviewInterventionExecution(executionId, "approved");
                    } else if (action === "cancel") {
                        await reviewInterventionExecution(executionId, "cancelled");
                    } else if (action === "execute") {
                        if (!window.confirm("Execute the approved intervention? This will create one controlled workspace task and verify the result.")) {
                            executionButton.disabled = false;
                            return;
                        }
                        await callInterventionFunction("execute", executionId);
                    } else if (action === "verify") {
                        await callInterventionFunction("verify", executionId);
                    }
                    await refresh();
                } catch (error) {
                    window.alert(error.message || "Controlled intervention operation failed.");
                    executionButton.disabled = false;
                }
                return;
            }

            const button = event.target.closest("[data-im-incident-action]");
            if (!button) return;

            const id = String(button.getAttribute("data-im-incident-id") || "");
            const status = String(button.getAttribute("data-im-incident-action") || "");
            if (!id || !status) return;

            if (status === "resolved" && !window.confirm("Mark this operational incident as resolved?")) {
                return;
            }

            button.disabled = true;
            try {
                await review(id, status);
                await refresh();
            } catch (error) {
                window.alert(error.message || "Incident review failed.");
                button.disabled = false;
            }
        });

        refreshButton.addEventListener("click", refresh);
        panel.addEventListener("toggle", function () {
            if (panel.open) refresh();
        });

        refresh();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();