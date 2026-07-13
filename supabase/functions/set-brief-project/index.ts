// supabase/functions/set-brief-project/index.ts
//
// Request:  POST { brief_id: string, project_id: string | null }
// Response: 200 { ok: true, moved: boolean, seeded: boolean }
//         | 400/404/500 { error }
//
// Links (or unlinks) a briefed brief to a project. "Linking" today only set
// briefs.parent_project_id, which surfaces the brief under the project's
// Communications tab but NEVER under its Tasks list (Tasks = project_actuals
// rows, and sync-clickup-actuals is append-only — it never scans the list for
// new tasks). This function closes that gap:
//
//   Unlink (project_id === null):
//     - Delete the project_actuals row for (old parent_project_id,
//       brief.clickup_task_id) if the brief had a parent.
//     - Set parent_project_id = null. Leave the ClickUp task where it is.
//
//   Link (project_id present):
//     - Set parent_project_id = project_id.
//     - B) Move the brief's ClickUp task into the project's list so it groups
//        under the project in ClickUp. Endpoint (confirmed via context7 —
//        https://developer.clickup.com/docs/move-a-task-to-a-new-list):
//          POST https://api.clickup.com/api/v2/list/{list_id}/task/{task_id}
//        Best-effort: on failure console.error + continue.
//     - A) Seed a project_actuals row (idempotent) so the task shows in Tasks.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";

type Body = {
  brief_id?: string;
  project_id?: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as Body;
    const brief_id = body.brief_id;
    const project_id = body.project_id ?? null;

    if (!brief_id || typeof brief_id !== "string") {
      return json({ error: "brief_id required" }, 400);
    }

    const sb = createServiceRoleClient();

    // --- Load the brief (capture the CURRENT parent before we change it) ---
    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select("id, raw_subject, clickup_task_id, parent_project_id")
      .eq("id", brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const previousProjectId = brief.parent_project_id as string | null;
    const clickupTaskId = brief.clickup_task_id as string | null;

    // =====================================================================
    // Unlink path
    // =====================================================================
    if (project_id === null) {
      // Remove the seeded task row from the OLD project's Tasks list (if any).
      if (previousProjectId && clickupTaskId) {
        const { error: delErr } = await sb
          .from("project_actuals")
          .delete()
          .eq("project_id", previousProjectId)
          .eq("clickup_task_id", clickupTaskId);
        if (delErr) {
          console.error(
            `[set-brief-project] project_actuals delete failed for (${previousProjectId}, ${clickupTaskId}): ${delErr.message}`,
          );
        }
      }

      const { error: updErr } = await sb
        .from("briefs")
        .update({ parent_project_id: null, updated_at: new Date().toISOString() })
        .eq("id", brief_id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ ok: true, moved: false, seeded: false });
    }

    // =====================================================================
    // Link path
    // =====================================================================
    const { data: project, error: pErr } = await sb
      .from("projects")
      .select("id, clickup_list_id, clickup_parent_task_id")
      .eq("id", project_id)
      .single();
    if (pErr || !project) return json({ error: pErr?.message ?? "Project not found" }, 404);

    // Set the parent link first — this is the load-bearing change.
    const { error: updErr } = await sb
      .from("briefs")
      .update({ parent_project_id: project_id, updated_at: new Date().toISOString() })
      .eq("id", brief_id);
    if (updErr) return json({ error: updErr.message }, 500);

    let moved = false;
    let seeded = false;

    const clickupListId = project.clickup_list_id as string | null;
    const clickupParentTaskId = project.clickup_parent_task_id as string | null;

    if (clickupTaskId && clickupListId) {
      const { token: clickupPat } = await getOperatorClickupToken(req);
      if (!clickupPat) {
        console.error("[set-brief-project] CLICKUP_PAT secret not set — skipping ClickUp move + task read");
      } else {
        const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };

        // --- B) Reparent the task under the project's umbrella task
        // (best-effort). This nests it under the project AND moves its home
        // list to the project's list (a subtask lives in its parent's list).
        // NB: ClickUp's POST /list/{id}/task/{id} only ADDS a secondary list
        // membership (Tasks-in-Multiple-Lists ClickApp) and does NOT change the
        // home list, so reparenting is the correct "group under the project"
        // mechanism. ---
        if (clickupParentTaskId) {
          try {
            const reparentRes = await fetch(
              `https://api.clickup.com/api/v2/task/${clickupTaskId}`,
              { ...CU, method: "PUT", body: JSON.stringify({ parent: clickupParentTaskId }) },
            );
            if (reparentRes.ok) {
              moved = true;
            } else {
              console.error(
                `[set-brief-project] CU reparent task ${clickupTaskId} -> parent ${clickupParentTaskId} failed (${reparentRes.status}: ${await reparentRes.text()})`,
              );
            }
          } catch (re) {
            console.error(
              `[set-brief-project] CU reparent threw for task ${clickupTaskId}: ${re instanceof Error ? re.message : String(re)}`,
            );
          }
        }

        // --- A) Seed a project_actuals row so it shows in Tasks (idempotent) ---
        const { data: existing, error: exErr } = await sb
          .from("project_actuals")
          .select("id")
          .eq("project_id", project_id)
          .eq("clickup_task_id", clickupTaskId)
          .maybeSingle();
        if (exErr) {
          console.error(
            `[set-brief-project] project_actuals existence check failed for (${project_id}, ${clickupTaskId}): ${exErr.message}`,
          );
        }

        if (!existing) {
          // Read the task's name + time_estimate (ms) to seed planned_hours.
          let taskName: string = brief.raw_subject ?? "Untitled task";
          let plannedHours = 0;
          try {
            const taskRes = await fetch(
              `https://api.clickup.com/api/v2/task/${clickupTaskId}`,
              CU,
            );
            if (taskRes.ok) {
              const t = (await taskRes.json()) as { name?: string; time_estimate?: number | null };
              if (t.name && t.name.trim().length > 0) taskName = t.name;
              if (typeof t.time_estimate === "number" && t.time_estimate > 0) {
                plannedHours = Math.round((t.time_estimate / 3_600_000) * 100) / 100;
              }
            } else {
              console.error(
                `[set-brief-project] CU get task ${clickupTaskId} failed (${taskRes.status}: ${await taskRes.text()})`,
              );
            }
          } catch (ge) {
            console.error(
              `[set-brief-project] CU get task threw for ${clickupTaskId}: ${ge instanceof Error ? ge.message : String(ge)}`,
            );
          }

          const { error: paErr } = await sb.from("project_actuals").insert({
            project_id,
            clickup_task_id: clickupTaskId,
            task_name: taskName,
            planned_hours: plannedHours,
            dept_id: null,
          });
          if (paErr) {
            console.error(
              `[set-brief-project] project_actuals insert failed for (${project_id}, ${clickupTaskId}): ${paErr.message}`,
            );
          } else {
            seeded = true;
          }
        }
      }
    }

    return json({ ok: true, moved, seeded });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
