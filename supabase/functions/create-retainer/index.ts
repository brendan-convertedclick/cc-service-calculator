// supabase/functions/create-retainer/index.ts
//
// Request:  POST {
//   client_id, clickup_list_id, name, retainer_hours_target,
//   retainer_monthly_fee_cents, recurrence_start,
//   services: Array<{ service_id, cadence, occurrences_per_month,
//                     points_per_occurrence, default_assignees, is_live_eligible }>
// }
// Response: 200 { project_id, clickup_parent_task_id, provision } | { ..., provision_warning }
//
// Orchestrates standalone retainer creation, mirroring push-to-clickup:
//   1. Validate body + confirm client and its active ClickUp list.
//   2. Create a ClickUp "retainer parent" task in clickup_list_id (status omitted → CRTSK_001).
//   3. Insert the projects row (engagement_type='retainer', status='in_progress',
//      is_recurring=true, due_date=month-end of recurrence_start; the monthly
//      roll-forward cron advances due_date each period).
//   4. Insert one retainer_recurring_services row per service.
//   5. Invoke provision-retainer-period { project_id } for the current period.
//
// Cleanup mirrors push-to-clickup's delete-on-failure pattern: a services-insert
// failure rolls back the project + best-effort deletes the ClickUp parent task;
// a provision failure keeps the project + services and returns a provision_warning
// (the monthly cron / a manual retry can provision later).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const VALID_CADENCES = ["daily", "weekly", "biweekly", "monthly", "custom"];

type ServiceInput = {
  service_id: string;
  cadence: string;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
};

type RetainerBody = {
  client_id?: string;
  clickup_list_id?: string;
  name?: string;
  retainer_hours_target?: number;
  retainer_monthly_fee_cents?: number;
  recurrence_start?: string;
  services?: ServiceInput[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as RetainerBody;
    const {
      client_id,
      clickup_list_id,
      name,
      retainer_hours_target,
      retainer_monthly_fee_cents,
      recurrence_start,
      services,
    } = body;

    // --- Validation (400 on failure) ---
    if (!client_id) return json({ error: "client_id required" }, 400);
    if (!clickup_list_id) return json({ error: "clickup_list_id required" }, 400);
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return json({ error: "name required" }, 400);
    }
    if (!recurrence_start) return json({ error: "recurrence_start required" }, 400);
    const recurrenceStartDate = new Date(recurrence_start);
    if (isNaN(recurrenceStartDate.getTime())) {
      return json({ error: "recurrence_start must be a valid date" }, 400);
    }
    if (typeof retainer_hours_target !== "number" || !(retainer_hours_target > 0)) {
      return json({ error: "retainer_hours_target must be a positive number" }, 400);
    }
    if (
      typeof retainer_monthly_fee_cents !== "number" ||
      !Number.isInteger(retainer_monthly_fee_cents) ||
      retainer_monthly_fee_cents < 0
    ) {
      return json({ error: "retainer_monthly_fee_cents must be a non-negative integer" }, 400);
    }
    if (!Array.isArray(services) || services.length < 1) {
      return json({ error: "At least one recurring service is required" }, 400);
    }
    for (const [i, svc] of services.entries()) {
      if (!svc.service_id) {
        return json({ error: `services[${i}]: service_id required` }, 400);
      }
      if (!VALID_CADENCES.includes(svc.cadence)) {
        return json({
          error: `services[${i}]: cadence must be one of ${VALID_CADENCES.join(", ")}`,
        }, 400);
      }
      if (typeof svc.occurrences_per_month !== "number" || !(svc.occurrences_per_month > 0)) {
        return json({ error: `services[${i}]: occurrences_per_month must be > 0` }, 400);
      }
      if (typeof svc.points_per_occurrence !== "number" || !(svc.points_per_occurrence > 0)) {
        return json({ error: `services[${i}]: points_per_occurrence must be > 0` }, 400);
      }
      if (!Array.isArray(svc.default_assignees) || svc.default_assignees.length < 1) {
        return json({
          error: `services[${i}]: at least one default assignee is required`,
        }, 400);
      }
    }

    const sb = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    // --- Step 1: load client + confirm the active ClickUp list belongs to it ---
    const { data: client, error: cErr } = await sb
      .from("clients")
      .select("id, name")
      .eq("id", client_id)
      .single();
    if (cErr || !client) return json({ error: cErr?.message ?? "Client not found" }, 404);

    const { data: list, error: lErr } = await sb
      .from("client_lists")
      .select("id, clickup_list_id, client_id")
      .eq("client_id", client_id)
      .eq("clickup_list_id", clickup_list_id)
      .is("archived_at", null)
      .maybeSingle();
    if (lErr) return json({ error: lErr.message }, 500);
    if (!list) {
      return json({
        error: "clickup_list_id is not an active ClickUp list for this client.",
      }, 400);
    }

    // --- Step 2: create the ClickUp parent task (omit status → CRTSK_001) ---
    const parentTaskId = await createClickupTask(clickupPat, clickup_list_id, {
      name: `[Retainer] ${client.name} — ${name.trim()}`,
      description:
        `Retainer parent task for ${client.name}.\n` +
        `Recurring services provisioned monthly by the Phase 8 provisioner.`,
    });
    if (!parentTaskId) {
      return json({ error: "Failed to create ClickUp retainer parent task." }, 502);
    }

    // --- Step 3: insert the projects row ---
    // is_recurring=true marks the retainer as a recurring project; execution
    // stays with provision-retainer-period (create-recurring-tasks excludes
    // engagement_type='retainer'). due_date = first period's month-end.
    const firstPeriodEnd = new Date(Date.UTC(
      recurrenceStartDate.getUTCFullYear(),
      recurrenceStartDate.getUTCMonth() + 1,
      0,
    ));
    const { data: project, error: pErr } = await sb
      .from("projects")
      .insert({
        name: name.trim(),
        client_id,
        engagement_type: "retainer",
        status: "in_progress",
        is_recurring: true,
        recurrence_mode: "none",
        recurrence_interval: "monthly",
        recurrence_start,
        due_date: firstPeriodEnd.toISOString(),
        retainer_hours_target,
        retainer_monthly_fee_cents,
        clickup_list_id,
        clickup_parent_task_id: parentTaskId,
      })
      .select("id")
      .single();
    if (pErr || !project) {
      // Best-effort delete the orphaned ClickUp parent task.
      await deleteClickupTask(clickupPat, parentTaskId);
      return json({ error: pErr?.message ?? "Failed to insert project" }, 500);
    }
    const projectId = project.id as string;

    // --- Step 4: insert one retainer_recurring_services row per service ---
    const serviceRows = services.map((svc) => ({
      project_id: projectId,
      service_id: svc.service_id,
      cadence: svc.cadence,
      occurrences_per_month: svc.occurrences_per_month,
      points_per_occurrence: svc.points_per_occurrence,
      default_assignees: svc.default_assignees,
      is_live_eligible: svc.is_live_eligible ?? true,
    }));
    const { error: rrsErr } = await sb
      .from("retainer_recurring_services")
      .insert(serviceRows);
    if (rrsErr) {
      // Compensating cleanup: delete the project row (cascades any partial
      // services) and best-effort delete the ClickUp parent task.
      let rollbackErr: string | null = null;
      try {
        const { error: delErr } = await sb.from("projects").delete().eq("id", projectId);
        if (delErr) rollbackErr = delErr.message;
      } catch (e) {
        rollbackErr = e instanceof Error ? e.message : String(e);
      }
      await deleteClickupTask(clickupPat, parentTaskId);
      return json(
        rollbackErr
          ? { error: rrsErr.message, rollback_error: rollbackErr }
          : { error: rrsErr.message },
        500,
      );
    }

    // --- Step 5: provision the current period's ClickUp tasks ---
    // Keep the project + services even if this fails — the monthly cron or a
    // manual retry can provision later. Surface a non-blocking warning instead.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/provision-retainer-period`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: anon },
        body: JSON.stringify({ project_id: projectId }),
      });
      const provision = await res.json();
      if (!res.ok) {
        return json({
          project_id: projectId,
          clickup_parent_task_id: parentTaskId,
          provision_warning:
            "Retainer created, but first-period provisioning failed — retry from the monthly cron or re-provision manually.",
          provision_error: provision,
        });
      }
      // Seed project_actuals right away so the new retainer's tasks appear in
      // Conductor immediately instead of waiting for the hourly cron. Fire-and-
      // forget — a failure here is non-fatal (the cron still catches up).
      try {
        await fetch(`${supabaseUrl}/functions/v1/sync-clickup-actuals`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: anon },
          body: JSON.stringify({ project_id: projectId }),
        });
      } catch { /* non-fatal */ }
      return json({
        project_id: projectId,
        clickup_parent_task_id: parentTaskId,
        provision,
      });
    } catch (e) {
      return json({
        project_id: projectId,
        clickup_parent_task_id: parentTaskId,
        provision_warning:
          "Retainer created, but first-period provisioning failed — retry from the monthly cron or re-provision manually.",
        provision_error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function createClickupTask(
  pat: string,
  listId: string,
  args: { name: string; description: string },
): Promise<string | null> {
  // Omit `status` — let ClickUp use the list's default. Client spaces use
  // custom status sets, so hardcoding "to do" fails with CRTSK_001.
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify({ name: args.name, description: args.description }),
  });
  if (!res.ok) return null;
  const r = (await res.json()) as { id: string };
  return r.id;
}

async function deleteClickupTask(pat: string, taskId: string): Promise<void> {
  try {
    await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: pat, "Content-Type": "application/json" },
    });
  } catch {
    // Best-effort cleanup — ignore failures.
  }
}
