// supabase/functions/log-ai-session/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

interface RequestBody {
  logged_by: string;
  session_date: string;           // ISO date e.g. "2026-05-12"
  clickup_task_id?: string;
  project_slug?: string;
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_duration_minutes: number;
  ai_cost_zar: number;
  human_minutes: number;
  concurrent_sessions: number;
  engagement_type: "task" | "agent-run";
  agent_id?: string;
}

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

  const sb = createServiceRoleClient();

  // Write to ai_sessions
  const { data: session, error: insertErr } = await sb
    .from("ai_sessions")
    .insert({
      logged_by: body.logged_by,
      session_date: body.session_date,
      clickup_task_id: body.clickup_task_id ?? null,
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

  // Optionally patch ClickUp task custom fields
  if (body.clickup_task_id) {
    const pat = Deno.env.get("CLICKUP_PAT");
    if (pat) {
      await patchClickUpAiFields(pat, body.clickup_task_id, {
        ai_input_tokens: body.ai_input_tokens,
        ai_output_tokens: body.ai_output_tokens,
        ai_cost_zar: body.ai_cost_zar,
        ai_duration_minutes: body.ai_duration_minutes,
      });
    }
  }

  return json({ id: session.id });
});

interface AiFields {
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_cost_zar: number;
  ai_duration_minutes: number;
}

async function patchClickUpAiFields(pat: string, taskId: string, fields: AiFields) {
  // Fetch the task to discover its custom field IDs
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
      await fetch(
        `https://api.clickup.com/api/v2/task/${taskId}/field/${cuField.id}`,
        {
          method: "POST",
          headers: {
            Authorization: pat,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value }),
        },
      );
    }),
  );
}
