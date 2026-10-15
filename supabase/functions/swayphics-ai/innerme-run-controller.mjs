/**
 * Pure validators and dependency readiness checks for InnerMe's durable run controller.
 * This file performs no network or database calls. The authoritative transition
 * rules are enforced again by the authenticated PostgreSQL RPC.
 */

const CHECKPOINT_KEYS = new Set([
  "phase",
  "progress_summary",
  "verified_artifact_refs",
  "unresolved_items",
  "next_action",
  "error_code",
]);

const COMPLETION_EVIDENCE_KEYS = new Set([
  "verified_by_human",
  "verification_method",
  "summary",
  "evidence_refs",
]);

const EVIDENCE_SOURCES = new Set([
  "workspace_record",
  "task_record",
  "email_message",
  "test_result",
  "external_url",
  "manual_attestation",
  "other",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildInnerMeRunCheckpoint(summary, options = {}) {
  const progressSummary = clean(summary);
  if (progressSummary.length < 10 || progressSummary.length > 1200) {
    throw new Error("Checkpoint summary must contain 10 to 1,200 characters.");
  }
  const unresolved = Array.isArray(options.unresolvedItems)
    ? options.unresolvedItems.map(clean).filter(Boolean).slice(0, 12)
    : [];
  if (unresolved.some((item) => item.length > 500)) {
    throw new Error("Each unresolved item must be 500 characters or fewer.");
  }

  const payload = {
    phase: clean(options.phase) || "manual_operator_checkpoint",
    progress_summary: progressSummary,
    verified_artifact_refs: [],
    unresolved_items: unresolved,
  };
  if (options.nextAction !== undefined) {
    const nextAction = clean(options.nextAction);
    if (nextAction.length > 400) throw new Error("Next action must be 400 characters or fewer.");
    if (nextAction) payload.next_action = nextAction;
  }
  if (payload.phase.length > 80) throw new Error("Checkpoint phase must be 80 characters or fewer.");
  return payload;
}

export function validateInnerMeRunCheckpoint(note, checkpoint) {
  const errors = [];
  const progressNote = clean(note);

  if (progressNote.length < 10 || progressNote.length > 1200) {
    errors.push("note_length_invalid");
  }
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return { valid: false, errors: [...errors, "checkpoint_not_object"] };
  }

  for (const key of Object.keys(checkpoint)) {
    if (!CHECKPOINT_KEYS.has(key)) errors.push("checkpoint_key_not_allowed:" + key);
  }
  if (!clean(checkpoint.phase) || clean(checkpoint.phase).length > 80) errors.push("checkpoint_phase_invalid");
  if (!clean(checkpoint.progress_summary) || clean(checkpoint.progress_summary).length > 1200) errors.push("checkpoint_summary_invalid");

  for (const key of ["verified_artifact_refs", "unresolved_items"]) {
    const value = checkpoint[key];
    if (value !== undefined && !Array.isArray(value)) errors.push(key + "_not_array");
    if (Array.isArray(value) && value.length > 12) errors.push(key + "_too_many");
  }
  if (Array.isArray(checkpoint.unresolved_items) &&
      checkpoint.unresolved_items.some((item) => typeof item !== "string" || item.length > 500)) {
    errors.push("unresolved_item_invalid");
  }
  if (checkpoint.next_action !== undefined &&
      (typeof checkpoint.next_action !== "string" || checkpoint.next_action.length > 400)) {
    errors.push("next_action_invalid");
  }
  if (checkpoint.error_code !== undefined &&
      (typeof checkpoint.error_code !== "string" || checkpoint.error_code.length > 80)) {
    errors.push("error_code_invalid");
  }

  const bytes = new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength;
  if (bytes > 8000) errors.push("checkpoint_too_large");

  return { valid: errors.length === 0, errors };
}

export function buildInnerMeCompletionEvidence({ summary, evidenceReference, verificationMethod }) {
  const cleanSummary = clean(summary);
  const reference = clean(evidenceReference);
  const method = clean(verificationMethod);

  if (cleanSummary.length < 20 || cleanSummary.length > 1200) {
    throw new Error("Verification summary must contain 20 to 1,200 characters.");
  }
  if (reference.length < 3 || reference.length > 240) {
    throw new Error("Evidence reference must contain 3 to 240 characters.");
  }
  if (!method || method.length > 500) {
    throw new Error("A verification method is required and must be 500 characters or fewer.");
  }

  return {
    verified_by_human: true,
    verification_method: method,
    summary: cleanSummary,
    evidence_refs: [{
      source: "manual_attestation",
      id: reference,
      why: cleanSummary.slice(0, 500),
    }],
  };
}

export function validateInnerMeCompletionEvidence(note, step, evidence) {
  const errors = [];
  const cleanNote = clean(note);

  if (cleanNote.length < 20 || cleanNote.length > 1200) errors.push("completion_note_invalid");
  if (!clean(step?.success_signal)) errors.push("step_success_signal_missing");
  if (!clean(step?.verification_method)) errors.push("step_verification_method_missing");

  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { valid: false, errors: [...errors, "completion_evidence_not_object"] };
  }

  for (const key of Object.keys(evidence)) {
    if (!COMPLETION_EVIDENCE_KEYS.has(key)) errors.push("completion_evidence_key_not_allowed:" + key);
  }
  if (evidence.verified_by_human !== true) errors.push("human_verification_required");
  if (!clean(evidence.verification_method) || clean(evidence.verification_method).length > 500) {
    errors.push("verification_method_invalid");
  }
  if (!clean(evidence.summary) || clean(evidence.summary).length > 1200) errors.push("verification_summary_invalid");

  const refs = evidence.evidence_refs;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 12) {
    errors.push("evidence_refs_invalid");
  } else {
    for (const ref of refs) {
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        errors.push("evidence_ref_not_object");
        continue;
      }
      if (!EVIDENCE_SOURCES.has(clean(ref.source))) errors.push("evidence_source_invalid");
      if (!clean(ref.id) || clean(ref.id).length > 240) errors.push("evidence_id_invalid");
      if (!clean(ref.why) || clean(ref.why).length > 500) errors.push("evidence_reason_invalid");
      if (Object.keys(ref).some((key) => !["source", "id", "why"].includes(key))) {
        errors.push("evidence_ref_key_not_allowed");
      }
    }
  }

  const bytes = new TextEncoder().encode(JSON.stringify(evidence)).byteLength;
  if (bytes > 8000) errors.push("completion_evidence_too_large");

  return { valid: errors.length === 0, errors };
}

/**
 * Choose only approved/in-progress steps whose observable dependencies are
 * completed. Missing/incomplete success contracts are separately reportable.
 */
export function selectInnerMeActionReadySteps(steps) {
  const rows = Array.isArray(steps) ? steps : [];
  const byOrder = new Map(rows.map((row) => [Number(row?.step_order), row]));
  const ready = [];
  const skippedUnverified = [];
  const skippedDependencies = [];
  const skippedNotActionable = [];

  for (const step of rows) {
    const order = Number(step?.step_order);
    const status = clean(step?.status);
    if (!["approved", "in_progress"].includes(status)) {
      skippedNotActionable.push(order);
      continue;
    }

    if (!clean(step?.success_signal) || !clean(step?.verification_method)) {
      skippedUnverified.push(order);
      continue;
    }

    // A plan step must be explicitly started through the run controller before
    // the model may prepare its controlled action proposal.
    if (status !== "in_progress" || !clean(step?.started_at)) {
      skippedNotActionable.push(order);
      continue;
    }

    const rawDependency = step?.depends_on_step_order;
    if (rawDependency !== null && rawDependency !== undefined && rawDependency !== "") {
      const dependencyOrder = Number(rawDependency);
      const dependency = byOrder.get(dependencyOrder);
      if (!dependency || clean(dependency.status) !== "completed") {
        skippedDependencies.push({
          step_order: order,
          depends_on_step_order: Number.isInteger(dependencyOrder) ? dependencyOrder : null,
          dependency_status: dependency ? clean(dependency.status) : "missing",
        });
        continue;
      }
    }

    ready.push(step);
  }

  return {
    ready,
    skipped_unverified_step_orders: skippedUnverified.filter(Number.isInteger),
    skipped_dependency_steps: skippedDependencies,
    skipped_not_actionable_step_orders: skippedNotActionable.filter(Number.isInteger),
  };
}
