// supabase/functions/update-retainer-services/index.ts
//
// Request:  POST {
//   project_id,
//   services: Array<{ id?, service_id, cadence, occurrences_per_month,
//                     points_per_occurrence, default_assignees, is_live_eligible }>
// }
// Response: 200 { updated, inserted, deleted }
//
// Reconciles a retainer's recurring services after creation: UPDATE rows with an
// id, INSERT rows without one, DELETE existing rows no longer present. Changes
// apply to the NEXT provisioning cycle — the current period's already-provisioned
// ClickUp tasks are left untouched. (Deleting a recurring service cascades its
// provisioned_tasks records; the ClickUp tasks + recorded actuals remain.)
// Call provision-retainer-period afterwards to push newly-added services into the
// current month on demand ("Provision now").

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const VALID_CADENCES = ["daily", "weekly", "biweekly", "monthly", "custom"];

// Normalise a per-occurrence day-of-month array: each entry becomes an int in
// 1–31, or 0 ("auto") when blank/invalid. Trailing auto entries are trimmed.
function sanitizeDays(days: number[] | undefined): number[] {
  const out = (days ?? []).map((d) => {
    const n = Math.round(Number(d));
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : 0;
  });
  while (out.length > 0 && out[out.length - 1] === 0) out.pop();
  return out;
}

type ServiceInput = {
  id?: string;
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  occurrence_labels?: string[];
  clickup_task_template_id?: string | null;
  task_description?: string | null;
  checklist_items?: string[];
  label_as_task_name?: boolean;
  occurrence_start_days?: number[];
  occurrence_due_days?: number[];
  roll_up_monthly?: boolean;
};

// First day of the current month (UTC), as a YYYY-MM-DD string. Used to scope
// cleanup to the open period onward so closed months keep their history.
function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

async function deleteClickupTask(pat: string, taskId: string): Promise<void> {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: pat, "Content-Type": "application/json" },
  });
  if (!res.ok) console.error(`delete task ${taskId} failed: ${res.status}`);
}

// For services being removed, trash their provisioned ClickUp tasks from the
// current month onward — skipping any that already have logged hours — and drop
// the matching actuals so they stop surfacing in Conductor. The cascade on the
// retainer_recurring_services delete handles the provisioned_tasks rows.
async function cleanupRemovedServiceTasks(
  // deno-lint-ignore no-explicit-any
  sb: any,
  projectId: string,
  serviceIds: string[],
): Promise<{ removed: number; keptLogged: number }> {
  const pat = Deno.env.get("CLICKUP_PAT");
  if (!pat) {
    console.error("CLICKUP_PAT not set — skipping ClickUp task cleanup");
    return { removed: 0, keptLogged: 0 };
  }

  // Gather candidate ClickUp task ids from this month's (and later) provisioned
  // rows for the removed services.
  const { data: provRows } = await sb
    .from("provisioned_tasks")
    .select("clickup_task_ids")
    .eq("project_id", projectId)
    .in("recurring_service_id", serviceIds)
    .gte("period_start", firstOfMonthIso());
  const candidateIds = [
    ...new Set(
      ((provRows ?? []) as Array<{ clickup_task_ids: string[] | null }>)
        .flatMap((r) => r.clickup_task_ids ?? []),
    ),
  ];
  if (candidateIds.length === 0) return { removed: 0, keptLogged: 0 };

  // Never trash a task that has logged time.
  const { data: logged } = await sb
    .from("project_actuals_current")
    .select("clickup_task_id")
    .eq("project_id", projectId)
    .in("clickup_task_id", candidateIds)
    .gt("actual_hours", 0);
  const loggedIds = new Set(
    ((logged ?? []) as Array<{ clickup_task_id: string }>).map((r) => r.clickup_task_id),
  );

  const toRemove = candidateIds.filter((id) => !loggedIds.has(id));
  for (const id of toRemove) await deleteClickupTask(pat, id);
  if (toRemove.length > 0) {
    await sb.from("project_actuals").delete()
      .eq("project_id", projectId).in("clickup_task_id", toRemove);
  }
  return { removed: toRemove.length, keptLogged: loggedIds.size };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { project_id, services, cleanup_removed_tasks } = (await req.json()) as {
      project_id?: string;
      services?: ServiceInput[];
      // When true, deleting a service also trashes its current/future ClickUp
      // tasks (only those with no logged time) so they don't linger as orphans.
      cleanup_removed_tasks?: boolean;
    };
    if (!project_id) return json({ error: "project_id required" }, 400);
    if (!Array.isArray(services) || services.length < 1) {
      return json({ error: "At least one recurring service is required" }, 400);
    }
    for (const [i, svc] of services.entries()) {
      if (!svc.service_id) return json({ error: `services[${i}]: service_id required` }, 400);
      if (!VALID_CADENCES.includes(svc.cadence)) {
        return json({ error: `services[${i}]: cadence must be one of ${VALID_CADENCES.join(", ")}` }, 400);
      }
      if (typeof svc.occurrences_per_month !== "number" || !(svc.occurrences_per_month > 0)) {
        return json({ error: `services[${i}]: occurrences_per_month must be > 0` }, 400);
      }
      if (typeof svc.points_per_occurrence !== "number" || !(svc.points_per_occurrence > 0)) {
        return json({ error: `services[${i}]: points_per_occurrence must be > 0` }, 400);
      }
      if (!Array.isArray(svc.default_assignees) || svc.default_assignees.length < 1) {
        return json({ error: `services[${i}]: at least one default assignee is required` }, 400);
      }
    }

    const sb = createServiceRoleClient();

    const { data: project, error: pErr } = await sb
      .from("projects").select("id, engagement_type").eq("id", project_id).single();
    if (pErr || !project) return json({ error: pErr?.message ?? "Project not found" }, 404);
    if (project.engagement_type !== "retainer") {
      return json({ error: "Project is not a retainer" }, 400);
    }

    const { data: existingRows, error: exErr } = await sb
      .from("retainer_recurring_services").select("id").eq("project_id", project_id);
    if (exErr) return json({ error: exErr.message }, 500);
    const existingIds = new Set((existingRows ?? []).map((r) => r.id as string));
    const keptIds = new Set(services.filter((s) => s.id).map((s) => s.id as string));

    let updated = 0;
    let inserted = 0;
    let deleted = 0;
    let tasks_removed = 0;
    let tasks_kept_logged = 0;

    const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
    if (toDelete.length > 0) {
      // Optional cleanup: before the cascade drops these services'
      // provisioned_tasks rows, trash their ClickUp tasks for the current month
      // onward — but only ones with no logged time, so nothing billable is lost.
      if (cleanup_removed_tasks) {
        const res = await cleanupRemovedServiceTasks(sb, project_id, toDelete);
        tasks_removed = res.removed;
        tasks_kept_logged = res.keptLogged;
      }
      const { error } = await sb.from("retainer_recurring_services").delete().in("id", toDelete);
      if (error) return json({ error: error.message }, 500);
      deleted = toDelete.length;
    }

    for (const svc of services) {
      const row = {
        service_id: svc.service_id,
        cadence: svc.cadence,
        occurrences_per_month: svc.occurrences_per_month,
        points_per_occurrence: svc.points_per_occurrence,
        default_assignees: svc.default_assignees,
        is_live_eligible: svc.is_live_eligible,
        occurrence_labels: (svc.occurrence_labels ?? []).map((l) => l.trim()).filter(Boolean),
        clickup_task_template_id: svc.clickup_task_template_id?.trim() || null,
        task_description: svc.task_description?.trim() || null,
        checklist_items: (svc.checklist_items ?? []).map((c) => c.trim()).filter(Boolean),
        label_as_task_name: !!svc.label_as_task_name,
        // Per-occurrence day-of-month overrides (0 = auto). Clamp to 1–31.
        occurrence_start_days: sanitizeDays(svc.occurrence_start_days),
        occurrence_due_days: sanitizeDays(svc.occurrence_due_days),
        roll_up_monthly: !!svc.roll_up_monthly,
      };
      if (svc.id && existingIds.has(svc.id)) {
        const { error } = await sb.from("retainer_recurring_services").update(row).eq("id", svc.id);
        if (error) return json({ error: error.message }, 500);
        updated += 1;
      } else {
        const { error } = await sb.from("retainer_recurring_services").insert({ ...row, project_id });
        if (error) return json({ error: error.message }, 500);
        inserted += 1;
      }
    }

    return json({ updated, inserted, deleted, tasks_removed, tasks_kept_logged });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
