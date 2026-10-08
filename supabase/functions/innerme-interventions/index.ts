import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function corsHeaders(origin = "") {
  return {
    ...supabaseCorsHeaders,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

function clean(value: unknown, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function priorityForSeverity(severity: string) {
  if (severity === "critical") return "high";
  if (severity === "high") return "medium";
  return "low";
}

function nextBusinessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  const current = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
    ),
  );
  current.setUTCDate(current.getUTCDate() + 1);

  return current.toISOString().slice(0, 10);
}

function taskRefs(sourceTable: string, evidence: Record<string, any>) {
  const refs: Record<string, string> = {};
  const snapshot = evidence?.snapshot || {};

  if (sourceTable === "leads" && evidence?.source_id) {
    refs.lead_id = String(evidence.source_id);
  }

  if (sourceTable === "follow_ups") {
    if (snapshot?.lead_id) refs.lead_id = String(snapshot.lead_id);
    if (snapshot?.client_id) refs.client_id = String(snapshot.client_id);
  }

  if (sourceTable === "tasks") {
    if (snapshot?.lead_id) refs.lead_id = String(snapshot.lead_id);
    if (snapshot?.client_id) refs.client_id = String(snapshot.client_id);
    if (snapshot?.project_id) refs.project_id = String(snapshot.project_id);
  }

  if (sourceTable === "invoices") {
    if (snapshot?.client_id) refs.client_id = String(snapshot.client_id);
    if (snapshot?.project_id) refs.project_id = String(snapshot.project_id);
  }

  if (sourceTable === "clients" && evidence?.source_id) {
    refs.client_id = String(evidence.source_id);
  }

  if (sourceTable === "client_projects" && evidence?.source_id) {
    refs.project_id = String(evidence.source_id);
  }

  return refs;
}

async function authenticate(
  req: Request,
  admin: ReturnType<typeof createClient>,
) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) throw new Error("Authentication required.");

  const { data: userData, error: userError } =
    await admin.auth.getUser(token);

  if (userError || !userData?.user) {
    throw new Error("Authenticated admin session required.");
  }

  const { data: adminRow, error: adminError } = await admin
    .from("admin_users")
    .select("user_id,active")
    .eq("user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminError || !adminRow) {
    throw new Error("Swayphics admin access required.");
  }

  return userData.user;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { error: "Intervention service configuration is incomplete." },
      500,
      origin,
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const user = await authenticate(req, admin);
    let body: { action?: string; execution_id?: string } = {};

    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400, origin);
    }

    const action = String(body.action || "").trim().toLowerCase();
    const executionId = String(body.execution_id || "").trim();

    if (!executionId) {
      return json({ error: "execution_id is required." }, 400, origin);
    }

    const { data: execution, error: executionError } = await admin
      .from("innerme_incident_intervention_executions")
      .select(
        "*,innerme_incident_intervention_selection!inner(incident_id,selected_option_id,selection_status,condition_fingerprint),innerme_incident_intervention_options!inner(recommendation_status,conflict_status,action_statement,condition_fingerprint)",
      )
      .eq("id", executionId)
      .maybeSingle();

    if (executionError || !execution) {
      return json(
        { error: "The intervention execution could not be found." },
        404,
        origin,
      );
    }

    const selection = execution.innerme_incident_intervention_selection;
    const option = execution.innerme_incident_intervention_options;

    if (
      !selection ||
      selection.selection_status !== "selected" ||
      selection.selected_option_id !== execution.option_id ||
      option.recommendation_status !== "recommended" ||
      option.conflict_status === "blocked" ||
      selection.condition_fingerprint !== execution.condition_fingerprint ||
      option.condition_fingerprint !== execution.condition_fingerprint
    ) {
      return json(
        {
          error:
            "The intervention approval conditions are no longer valid. Re-run incident analysis.",
        },
        409,
        origin,
      );
    }

    if (action === "verify") {
      if (!execution.task_id) {
        return json({
          ok: false,
          verification_status: "failed",
          verification_note:
            "No task is attached to this intervention execution.",
        }, 200, origin);
      }

      const { data: task, error: taskError } = await admin
        .from("tasks")
        .select(
          "id,title,description,assigned_to,lead_id,client_id,project_id,status,due_date,created_at",
        )
        .eq("id", execution.task_id)
        .maybeSingle();

      if (taskError || !task) {
        await admin
          .from("innerme_incident_intervention_executions")
          .update({
            verification_status: "failed",
            verification_note:
              "The executed task could not be found during verification.",
            status: "failed",
            error_message: "Post-execution task verification failed.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", execution.id);

        return json({
          ok: false,
          verification_status: "failed",
          verification_note:
            "The executed task could not be found during verification.",
        }, 200, origin);
      }

      const passed =
        execution.action_type === "create_task" &&
        Boolean(task.id) &&
        task.assigned_to === execution.executed_by;

      const note = passed
        ? "Verified: the approved intervention created the expected workspace task."
        : "Verification failed: the created record did not match the approved execution.";

      await admin
        .from("innerme_incident_intervention_executions")
        .update({
          verification_status: passed ? "passed" : "failed",
          verification_note: note,
          status: passed ? "succeeded" : "failed",
          execution_completed_at:
            execution.execution_completed_at ||
            new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return json({
        ok: passed,
        verification_status: passed ? "passed" : "failed",
        verification_note: note,
        task,
      }, 200, origin);
    }

    if (action !== "execute") {
      return json(
        { error: "Supported actions are execute and verify." },
        400,
        origin,
      );
    }

    if (execution.status === "succeeded") {
      return json({
        ok: true,
        status: execution.status,
        verification_status: execution.verification_status,
        task_id: execution.task_id,
        replay_safe: true,
      }, 200, origin);
    }

    if (execution.status !== "approved") {
      return json(
        { error: "Only approved interventions can be executed." },
        409,
        origin,
      );
    }

    const claimedAt = new Date().toISOString();

    const { data: claimed, error: claimError } = await admin
      .from("innerme_incident_intervention_executions")
      .update({
        status: "executing",
        executed_by: user.id,
        execution_started_at: claimedAt,
        verification_status: "pending",
        error_message: null,
        updated_at: claimedAt,
      })
      .eq("id", execution.id)
      .eq("status", "approved")
      .select("id,status")
      .maybeSingle();

    if (claimError || !claimed) {
      return json(
        {
          error:
            "The intervention could not be claimed. It may already be executing.",
        },
        409,
        origin,
      );
    }

    const { data: dependency, error: dependencyError } = await admin
      .from("innerme_incident_dependencies")
      .select("source_table,source_id,label,evidence,dependency_type")
      .eq("id", execution.dependency_id)
      .maybeSingle();

    const { data: incident, error: incidentError } = await admin
      .from("innerme_operational_incidents")
      .select("severity,title,incident_key")
      .eq("id", execution.incident_id)
      .maybeSingle();

    if (dependencyError || !dependency || incidentError || !incident) {
      const message =
        "The intervention dependencies could not be resolved.";

      await admin
        .from("innerme_incident_intervention_executions")
        .update({
          status: "failed",
          error_message: message,
          execution_completed_at: new Date().toISOString(),
          verification_status: "failed",
          verification_note: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return json({ error: message }, 409, origin);
    }

    const refs = taskRefs(
      dependency.source_table,
      dependency.evidence || {},
    );

    const taskPayload: Record<string, any> = {
      title: clean(
        "InnerMe intervention: " +
          (dependency.label || option.action_statement),
        160,
      ),
      description: clean(
        [
          option.action_statement,
          "",
          "Created by an explicitly approved InnerMe incident intervention.",
          "Incident: " +
            String(incident.incident_key || execution.incident_id),
          "The task is a controlled operational response. Task creation does not itself resolve the underlying incident.",
        ].join("\n"),
        2500,
      ),
      assigned_to: user.id,
      priority: priorityForSeverity(String(incident.severity || "medium")),
      status: "pending",
      due_date: nextBusinessDate(),
      ...refs,
    };

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert(taskPayload)
      .select(
        "id,title,description,assigned_to,lead_id,client_id,project_id,status,due_date,created_at",
      )
      .single();

    if (taskError || !task) {
      const message = clean(
        taskError?.message ||
          "Approved intervention could not create its task.",
        800,
      );

      await admin
        .from("innerme_incident_intervention_executions")
        .update({
          status: "failed",
          error_message: message,
          execution_completed_at: new Date().toISOString(),
          verification_status: "failed",
          verification_note: "Task creation failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return json({ error: message }, 500, origin);
    }

    const verified =
      task.status === "pending" &&
      task.assigned_to === user.id &&
      task.title === taskPayload.title;

    const verificationNote = verified
      ? "Verified: the approved intervention created the expected workspace task."
      : "Created task did not match the expected execution fields.";

    const { error: updateError } = await admin
      .from("innerme_incident_intervention_executions")
      .update({
        status: verified ? "succeeded" : "failed",
        task_id: task.id,
        execution_completed_at: new Date().toISOString(),
        verification_status: verified ? "passed" : "failed",
        verification_note: verificationNote,
        result_payload: {
          task_id: task.id,
          task,
          verified,
          execution_mode: "controlled_create_task",
        },
        error_message: verified ? null : verificationNote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", execution.id);

    if (updateError) {
      return json({
        ok: false,
        error:
          "The task was created, but the intervention audit record could not be finalized.",
        task_id: task.id,
      }, 500, origin);
    }

    return json({
      ok: verified,
      status: verified ? "succeeded" : "failed",
      verification_status: verified ? "passed" : "failed",
      verification_note: verificationNote,
      task,
    }, 200, origin);
  } catch (error) {
    return json(
      {
        error: clean(
          error instanceof Error ? error.message : String(error),
          800,
        ),
      },
      500,
      origin,
    );
  }
});
