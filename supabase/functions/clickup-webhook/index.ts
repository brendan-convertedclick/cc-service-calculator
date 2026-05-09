// supabase/functions/clickup-webhook/index.ts
//
// Receives POST events from ClickUp webhooks.
//
// Handles:
//   - taskStatusUpdated: when history_items[*].after === 'complete',
//     looks up the project via project_actuals_current.clickup_task_id and:
//       * sets projects.completed_at = event date (if currently null)
//       * sets projects.first_delivery_at = event date (if currently null)
//
// Deploy with verify_jwt=false — ClickUp cannot supply a Supabase JWT.
// The ClickUp webhook secret should be validated via X-Signature header
// if you add HMAC validation in a future phase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventName = body["event"] as string | undefined;

  // Only handle task status updates
  if (eventName !== "taskStatusUpdated") {
    return json({ ok: true, skipped: true });
  }

  const historyItems = (body["history_items"] as Array<Record<string, unknown>>) ?? [];
  const isComplete = historyItems.some(
    (item) =>
      typeof item["after"] === "string" &&
      ["complete", "closed", "done"].includes(item["after"].toLowerCase()),
  );

  if (!isComplete) {
    return json({ ok: true, skipped: true });
  }

  // Extract task ID and event date from the payload
  const taskId = body["task_id"] as string | undefined;
  // ClickUp sends date as unix ms in the webhook payload
  const rawDate = body["date"] as string | number | undefined;
  const eventDate = rawDate
    ? new Date(typeof rawDate === "string" ? parseInt(rawDate, 10) : rawDate).toISOString()
    : new Date().toISOString();

  if (!taskId) {
    return json({ error: "No task_id in payload" }, 400);
  }

  try {
    const supabase = createServiceRoleClient();

    // Find the project linked to this ClickUp task ID
    const { data: actuals, error: actualsErr } = await supabase
      .from("project_actuals_current")
      .select("project_id")
      .eq("clickup_task_id", taskId)
      .limit(1);

    if (actualsErr) throw actualsErr;
    if (!actuals || actuals.length === 0) {
      return json({ ok: true, skipped: true, reason: "task not tracked" });
    }

    const projectId = actuals[0].project_id;
    if (!projectId) {
      return json({ ok: true, skipped: true, reason: "null project_id" });
    }

    // Read current project state
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("completed_at, first_delivery_at")
      .eq("id", projectId)
      .single();

    if (projErr) throw projErr;

    const patch: Record<string, string> = {};
    if (!project.completed_at) {
      patch["completed_at"] = eventDate;
    }
    if (!project.first_delivery_at) {
      patch["first_delivery_at"] = eventDate;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateErr } = await supabase
        .from("projects")
        .update(patch)
        .eq("id", projectId);
      if (updateErr) throw updateErr;
    }

    return json({ ok: true, projectId, patched: Object.keys(patch) });
  } catch (err) {
    console.error("clickup-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});
