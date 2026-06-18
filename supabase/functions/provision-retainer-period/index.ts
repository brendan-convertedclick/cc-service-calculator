// supabase/functions/provision-retainer-period/index.ts
//
// Request:  POST { project_id: string, period_start?: string, rename_existing?: boolean }
// Response: 200 { created: number, reused: number, patched: number }
//
// Provisions ClickUp tasks for one retainer's period (default = current month).
// Idempotent: rerunning for the same (recurring_service × assignee × period)
// inserts nothing new (unique index).
//
// Per assignee × service:
//   if tracking_mode='live' AND service.is_live_eligible: ensure ONE perpetual task
//   else: seed N discrete dated tasks (N = occurrences_per_month)
//
// Each task is named "{Client} - {Service} - Week # - {Month Year} - DFT V1.1"
// (the "Week #" segment is dropped for monthly-cadence services) and carries the
// ClickUp custom fields Client Name / Engagement Type / Work Stream / Date of
// Engagement plus native sprint points — matching the /brief task convention.
//
// When called with rename_existing=true, already-provisioned tasks for the
// period are PATCHed (renamed + fields + points) instead of skipped. This is a
// deliberate one-off backfill switch — routine provisioning leaves existing
// tasks untouched so it never clobbers a manual revision suffix (DFT V2.1 /
// REV V1.1).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { findCustomField, resolveDropdownOption } from "../_shared/clickup.ts";
import type { CuField } from "../_shared/clickup.ts";

const POINT_TO_MIN = 15;
const REVISION_SUFFIX = "DFT V1.1";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type CustomField = { id: string; value: string | number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { project_id, period_start, rename_existing } = (await req.json()) as {
      project_id?: string;
      period_start?: string;
      rename_existing?: boolean;
    };
    if (!project_id) return json({ error: "project_id required" }, 400);

    const sb = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    // Resolve period (defaults to current month, Africa/Johannesburg).
    const periodStart = period_start ? new Date(period_start) : firstOfMonth(new Date());
    const periodEnd = lastOfMonth(periodStart);

    const { data: project, error: pErr } = await sb
      .from("projects")
      .select("id, clickup_list_id, client_id")
      .eq("id", project_id)
      .single();
    if (pErr || !project) return json({ error: pErr?.message ?? "Project not found" }, 404);
    if (!project.clickup_list_id) {
      return json({ error: "Project has no clickup_list_id — cannot provision tasks." }, 400);
    }

    const { data: services } = await sb
      .from("retainer_recurring_services")
      .select("*")
      .eq("project_id", project_id);
    if (!services || services.length === 0) {
      return json({ created: 0, reused: 0, patched: 0, note: "No recurring services on this project." });
    }

    // --- Resolve naming + custom-field inputs ---------------------------------
    const clientName = project.client_id
      ? (await sb.from("clients").select("name").eq("id", project.client_id).single()).data?.name ?? ""
      : "";

    // ClickUp custom field definitions for this list (drives Client Name /
    // Engagement Type / Work Stream / Date of Engagement). Failure → empty, so
    // tasks still create, just without custom fields.
    let cuFields: CuField[] = [];
    const fieldsRes = await fetch(
      `https://api.clickup.com/api/v2/list/${project.clickup_list_id}/field`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (fieldsRes.ok) cuFields = ((await fieldsRes.json()).fields ?? []) as CuField[];

    // Service name + dominant department (the service's "Work Stream"), keyed by
    // service_id. Dominant = the allocation with the highest pct.
    const serviceIds = [...new Set((services as Array<{ service_id: string }>).map((s) => s.service_id))];
    const serviceNameById = new Map<string, string>();
    const serviceDeptById = new Map<string, string>();
    if (serviceIds.length > 0) {
      const [{ data: svcRows }, { data: depts }, { data: allocs }] = await Promise.all([
        sb.from("services").select("id, name").in("id", serviceIds),
        sb.from("departments").select("id, name"),
        sb.from("service_allocation_resolved").select("service_id, department_id, pct").in("service_id", serviceIds),
      ]);
      for (const s of (svcRows ?? []) as Array<{ id: string; name: string }>) {
        serviceNameById.set(s.id, s.name);
      }
      const deptNameById = new Map<string, string>(
        ((depts ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
      );
      // Pick the highest-pct department per service.
      const topByService = new Map<string, { dept_id: string; pct: number }>();
      for (const a of (allocs ?? []) as Array<{ service_id: string; department_id: string | null; pct: number | null }>) {
        if (!a.department_id || a.pct == null) continue;
        const cur = topByService.get(a.service_id);
        if (!cur || a.pct > cur.pct) topByService.set(a.service_id, { dept_id: a.department_id, pct: a.pct });
      }
      for (const [svcId, top] of topByService) {
        const name = deptNameById.get(top.dept_id);
        if (name) serviceDeptById.set(svcId, name);
      }
    }

    const buildCustomFields = (serviceId: string, dateMs: number): CustomField[] => {
      const cf: CustomField[] = [];
      if (clientName) {
        const c = resolveDropdownOption(cuFields, "Client Name", clientName);
        if (c) cf.push(c);
      }
      const eng = resolveDropdownOption(cuFields, "Engagement Type", "Task");
      if (eng) cf.push(eng);
      const wsName = serviceDeptById.get(serviceId);
      if (wsName) {
        const ws = resolveDropdownOption(cuFields, "Work Stream", wsName);
        if (ws) cf.push(ws);
      }
      const dateField = findCustomField(cuFields, "Date of Engagement", "date");
      if (dateField) cf.push({ id: dateField.id, value: dateMs });
      return cf;
    };

    const taskName = (serviceId: string, d: Date, cadence: string): string => {
      const serviceName = serviceNameById.get(serviceId) ?? "Service";
      const week = cadence === "monthly" ? "" : `Week ${weekOfMonth(d)} - `;
      return `${clientName} - ${serviceName} - ${week}${monthYear(d)} - ${REVISION_SUFFIX}`;
    };
    const liveTaskName = (serviceId: string): string => {
      const serviceName = serviceNameById.get(serviceId) ?? "Service";
      return `[Live] ${clientName} - ${serviceName} - ${REVISION_SUFFIX}`;
    };
    const pointsFor = (svc: { points_per_occurrence: number }): number =>
      Math.max(1, Math.round(svc.points_per_occurrence));

    let created = 0;
    let reused = 0;
    let patched = 0;

    for (const svc of services as Array<{
      id: string;
      service_id: string;
      cadence: string;
      occurrences_per_month: number;
      points_per_occurrence: number;
      default_assignees: string[];
      is_live_eligible: boolean;
    }>) {
      for (const assigneeId of svc.default_assignees) {
        const { data: member } = await sb
          .from("team_members")
          .select("id, full_name, clickup_user_id, tracking_mode")
          .eq("id", assigneeId)
          .single();
        if (!member) continue;
        const mode =
          (member as { tracking_mode?: string }).tracking_mode === "live" && svc.is_live_eligible
            ? "live"
            : "manual";

        // Idempotency check: existing row?
        const { data: existing } = await sb
          .from("provisioned_tasks")
          .select("id, clickup_task_ids")
          .eq("recurring_service_id", svc.id)
          .eq("assignee_id", assigneeId)
          .eq("period_start", isoDate(periodStart))
          .maybeSingle();
        if (existing) {
          if (rename_existing) {
            // One-off backfill: rename + set fields + points on the tasks that
            // were created before this convention existed.
            const ids = (existing as { clickup_task_ids: string[] | null }).clickup_task_ids ?? [];
            const dates = mode === "live"
              ? [periodStart]
              : plannedTaskDates(periodStart, periodEnd, svc.cadence, svc.occurrences_per_month);
            for (let i = 0; i < ids.length; i++) {
              const d = dates[i] ?? dates[dates.length - 1] ?? periodStart;
              const name = mode === "live" ? liveTaskName(svc.service_id) : taskName(svc.service_id, d, svc.cadence);
              const cf = buildCustomFields(svc.service_id, (mode === "live" ? periodStart : d).getTime());
              const pr = await patchClickupTask(clickupPat, ids[i], {
                name,
                points: pointsFor(svc),
                customFields: cf,
              });
              if (pr.renameOk) patched += 1;
            }
          }
          reused += 1;
          continue;
        }

        const assigneeIds = (member as { clickup_user_id: number | null }).clickup_user_id
          ? [(member as { clickup_user_id: number }).clickup_user_id]
          : [];

        const taskIds: string[] = [];
        if (mode === "live") {
          // One perpetual task.
          const id = await createClickupTask(clickupPat, project.clickup_list_id!, {
            name: liveTaskName(svc.service_id),
            description:
              `Perpetual live task seeded by Phase 8 provisioner.\n` +
              `Time accrues here via Rize.io → ClickUp time-entry sync.`,
            assigneeIds,
            timeEstimateMs: 0,
            points: pointsFor(svc),
            customFields: buildCustomFields(svc.service_id, periodStart.getTime()),
          });
          if (id) taskIds.push(id);
        } else {
          // N discrete dated tasks.
          const dates = plannedTaskDates(periodStart, periodEnd, svc.cadence, svc.occurrences_per_month);
          for (const d of dates) {
            const id = await createClickupTask(
              clickupPat,
              project.clickup_list_id!,
              {
                name: taskName(svc.service_id, d, svc.cadence),
                description:
                  `Auto-seeded by Phase 8 provisioner. ` +
                  `Period ${isoDate(periodStart)} → ${isoDate(periodEnd)}.`,
                assigneeIds,
                timeEstimateMs: Math.round(svc.points_per_occurrence * POINT_TO_MIN * 60_000),
                dueDate: d.getTime(),
                points: pointsFor(svc),
                customFields: buildCustomFields(svc.service_id, d.getTime()),
              },
            );
            if (id) taskIds.push(id);
          }
        }

        await sb.from("provisioned_tasks").insert({
          project_id,
          recurring_service_id: svc.id,
          assignee_id: assigneeId,
          period_start: isoDate(periodStart),
          period_end: isoDate(periodEnd),
          mode,
          clickup_task_ids: taskIds,
        });
        created += 1;
      }
    }

    // On backfill, report which dropdown fields resolved so a Conductor↔ClickUp
    // name mismatch (e.g. client "Dovetail RSA" vs ClickUp option "Dovetail")
    // surfaces instead of being silently skipped.
    let field_resolution: Record<string, boolean> | undefined;
    if (rename_existing) {
      const firstDept = [...serviceDeptById.values()][0] ?? null;
      field_resolution = {
        clientName: !!(clientName && resolveDropdownOption(cuFields, "Client Name", clientName)),
        engagementType: !!resolveDropdownOption(cuFields, "Engagement Type", "Task"),
        workStream: !!(firstDept && resolveDropdownOption(cuFields, "Work Stream", firstDept)),
        dateOfEngagement: !!findCustomField(cuFields, "Date of Engagement", "date"),
      };
    }

    return json({ created, reused, patched, field_resolution });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function createClickupTask(
  pat: string,
  listId: string,
  args: {
    name: string;
    description: string;
    assigneeIds: number[];
    timeEstimateMs: number;
    dueDate?: number;
    points?: number;
    customFields?: CustomField[];
  },
): Promise<string | null> {
  const body: Record<string, unknown> = {
    name: args.name,
    description: args.description,
    // Omit `status` — let ClickUp use the list's default. Client spaces use
    // custom status sets, so hardcoding "to do" fails with CRTSK_001.
    time_estimate: args.timeEstimateMs,
  };
  if (args.assigneeIds.length > 0) body.assignees = args.assigneeIds;
  if (args.dueDate) body.due_date = args.dueDate;
  if (args.points !== undefined) body.points = args.points;
  if (args.customFields && args.customFields.length > 0) body.custom_fields = args.customFields;
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const r = (await res.json()) as { id: string };
  return r.id;
}

// Backfill an existing task: rename + native points via task update, then each
// custom field via its own endpoint. Returns true if the rename/points update
// succeeded (custom-field failures are logged but non-fatal).
async function patchClickupTask(
  pat: string,
  taskId: string,
  args: { name: string; points: number; customFields: CustomField[] },
): Promise<{ renameOk: boolean; fieldsSet: number; fieldsTotal: number }> {
  const headers = { Authorization: pat, "Content-Type": "application/json" };
  const upd = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name: args.name, points: args.points }),
  });
  if (!upd.ok) {
    console.error(`patch task ${taskId} rename failed: ${upd.status}`);
    return { renameOk: false, fieldsSet: 0, fieldsTotal: args.customFields.length };
  }
  let fieldsSet = 0;
  for (const cf of args.customFields) {
    const fr = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${cf.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ value: cf.value }),
    });
    if (fr.ok) fieldsSet += 1;
    else console.error(`patch task ${taskId} field ${cf.id} failed: ${fr.status}`);
  }
  return { renameOk: true, fieldsSet, fieldsTotal: args.customFields.length };
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function lastOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthYear(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function weekOfMonth(d: Date): number {
  return Math.floor((d.getUTCDate() - 1) / 7) + 1;
}

function plannedTaskDates(
  periodStart: Date,
  periodEnd: Date,
  cadence: string,
  occurrencesPerMonth: number,
): Date[] {
  const out: Date[] = [];
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  if (endMs < startMs) return out;
  const target = Math.max(1, Math.round(occurrencesPerMonth));

  if (cadence === "daily") {
    let d = new Date(periodStart);
    while (d.getTime() <= endMs && out.length < target) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) out.push(new Date(d));
      d = new Date(d.getTime() + 86_400_000);
    }
    return out;
  }
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
  const stride = Math.max(1, Math.floor(totalDays / target));
  let d = new Date(periodStart);
  while (out.length < target && d.getTime() <= endMs) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d = new Date(d.getTime() + stride * 86_400_000);
  }
  return out;
}
