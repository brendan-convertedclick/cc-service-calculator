// supabase/functions/log-ai-session/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

// ── Hardcoded ClickUp config (The Converted Click > Ops) ──────────────────

const CU_LIST_ID     = "901217934382";
const BRENDAN_CU_ID  = 4619351;

// Pre-resolved custom field option IDs
const CUSTOM_FIELDS_STATIC = [
  // Client Name = The Converted Click
  { id: "cb85dec8-42eb-46d2-89da-f8deb943377a", value: "a34ba210-42a2-473e-8279-f45fabeb9b44" },
  // Engagement Type = Task
  { id: "3bf088b1-392b-4e4f-8831-16d94bbc81d7", value: "793953f6-0c73-4a2c-9b90-7fd879732876" },
  // Work Stream = Development
  { id: "f4b5fb8a-c237-4c7e-8fec-bf48c6d8d38b", value: "18a513e0-936a-4da0-8163-53d4904d3d6e" },
];
const DATE_FIELD_ID = "c432caf3-3bb0-4423-bd5f-684639bef9aa";

// ── Types ─────────────────────────────────────────────────────────────────

interface RequestBody {
  logged_by: string;
  session_date: string;             // ISO date e.g. "2026-05-12"
  clickup_task_id?: string;         // if already created externally
  project_slug?: string;
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_duration_minutes: number;
  ai_cost_zar: number;
  human_minutes: number;
  concurrent_sessions: number;
  engagement_type: "task" | "agent-run";
  agent_id?: string;
  // Task creation (server-side, uses CLICKUP_PAT secret)
  create_clickup_task?: boolean;
  clickup_task_name?: string;
  clickup_task_description?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body.logged_by || !body.session_date) {
    return json({ error: "logged_by and session_date are required" }, 400);
  }

  const pat = Deno.env.get("CLICKUP_PAT");

  // Create ClickUp task server-side if requested
  let clickupTaskId = body.clickup_task_id ?? null;
  if (body.create_clickup_task && body.clickup_task_name && pat) {
    clickupTaskId = await createClickUpTask(pat, body.clickup_task_name, body.session_date, body.clickup_task_description);
  }

  // Write to ai_sessions
  const sb = createServiceRoleClient();
  const { data: session, error: insertErr } = await sb
    .from("ai_sessions")
    .insert({
      logged_by: body.logged_by,
      session_date: body.session_date,
      clickup_task_id: clickupTaskId,
      project_slug: body.project_slug ?? null,
      ai_input_tokens: body.ai_input_tokens,
      ai_output_tokens: body.ai_output_tokens,
      ai_duration_minutes: body.ai_duration_minutes,
      ai_cost_zar: body.ai_cost_zar,
      human_minutes: body.human_minutes,
      concurrent_sessions: body.concurrent_sessions,
      engagement_type: body.engagement_type,
      agent_id: body.agent_id ?? null,
    })
    .select("id")
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // Patch AI fields onto an existing ClickUp task if provided
  if (body.clickup_task_id && pat) {
    await patchClickUpAiFields(pat, body.clickup_task_id, {
      ai_input_tokens: body.ai_input_tokens,
      ai_output_tokens: body.ai_output_tokens,
      ai_cost_zar: body.ai_cost_zar,
      ai_duration_minutes: body.ai_duration_minutes,
    });
  }

  return json({ id: session.id, clickup_task_id: clickupTaskId });
});

// ── ClickUp helpers ───────────────────────────────────────────────────────

async function createClickUpTask(
  pat: string,
  name: string,
  sessionDate: string,
  description?: string,
): Promise<string | null> {
  // Convert session date to milliseconds for the date field
  const dateMs = new Date(sessionDate).getTime();

  const payload = {
    name,
    markdown_description: description ?? "",
    assignees: [BRENDAN_CU_ID],
    status: "closed",
    custom_fields: [
      ...CUSTOM_FIELDS_STATIC,
      { id: DATE_FIELD_ID, value: String(dateMs) },
    ],
  };

  const res = await fetch(`https://api.clickup.com/api/v2/list/${CU_LIST_ID}/task`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const taskId: string = data.id;

  // Ensure closed (some lists ignore status on create)
  await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "PUT",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "closed" }),
  }).catch(() => {});

  return taskId;
}

interface AiFields {
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_cost_zar: number;
  ai_duration_minutes: number;
}

async function patchClickUpAiFields(pat: string, taskId: string, fields: AiFields) {
  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: { Authorization: pat },
  });
  if (!taskRes.ok) return;

  const task = await taskRes.json();
  const cuFields: Array<{ id: string; name: string; value: unknown }> =
    task.custom_fields ?? [];

  const fieldMap: Record<string, number> = {
    ai_input_tokens: fields.ai_input_tokens,
    ai_output_tokens: fields.ai_output_tokens,
    ai_cost_zar: fields.ai_cost_zar,
    ai_duration_minutes: fields.ai_duration_minutes,
  };

  await Promise.all(
    Object.entries(fieldMap).map(async ([name, value]) => {
      const cuField = cuFields.find(
        (f) => f.name.toLowerCase().replace(/\s+/g, "_") === name,
      );
      if (!cuField) return;
      await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${cuField.id}`, {
        method: "POST",
        headers: { Authorization: pat, "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
    }),
  );
}
