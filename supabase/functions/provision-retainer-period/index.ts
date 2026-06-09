// supabase/functions/provision-retainer-period/index.ts
//
// Request:  POST { project_id: string, period_start?: string }
// Response: 200 { created: number, reused: number }
//
// Provisions ClickUp tasks for one retainer's period (default = current month).
// Idempotent: rerunning for the same (recurring_service × assignee × period)
// inserts nothing new (unique index).
//
// Per assignee × service:
//   if tracking_mode='live' AND service.is_live_eligible: ensure ONE perpetual task
//   else: seed N discrete dated tasks (N = occurrences_per_month)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

const POINT_TO_MIN = 15;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { project_id, period_start } = (await req.json()) as {
      project_id?: string;
      period_start?: string;
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
      return json({ created: 0, reused: 0, note: "No recurring services on this project." });
    }

    let created = 0;
    let reused = 0;

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
          reused += 1;
          continue;
        }

        const taskIds: string[] = [];
        if (mode === "live") {
          // One perpetual task.
          const id = await createClickupTask(clickupPat, project.clickup_list_id!, {
            name: `[Live] ${(member as { full_name: string }).full_name} — recurring (svc ${svc.service_id.slice(0, 8)})`,
            description:
              `Perpetual live task seeded by Phase 8 provisioner.\n` +
              `Time accrues here via Rize.io → ClickUp time-entry sync.`,
            assigneeIds: (member as { clickup_user_id: number | null }).clickup_user_id
              ? [(member as { clickup_user_id: number }).clickup_user_id]
              : [],
            timeEstimateMs: 0,
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
                name: `${(member as { full_name: string }).full_name} — recurring on ${isoDate(d)}`,
                description:
                  `Auto-seeded by Phase 8 provisioner. ` +
                  `Period ${isoDate(periodStart)} → ${isoDate(periodEnd)}.`,
                assigneeIds: (member as { clickup_user_id: number | null }).clickup_user_id
                  ? [(member as { clickup_user_id: number }).clickup_user_id]
                  : [],
                timeEstimateMs: Math.round(svc.points_per_occurrence * POINT_TO_MIN * 60_000),
                dueDate: d.getTime(),
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

    return json({ created, reused });
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
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const r = (await res.json()) as { id: string };
  return r.id;
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
