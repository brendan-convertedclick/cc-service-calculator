// supabase/functions/detect-project-problems/index.ts
//
// Request:  POST { project_id?: string }   // omit = all active projects
// Response: 200 { evaluated: number, upserted: number, resolved: number }
//
// Runs the Phase 5 problem detectors over current project state. Idempotent:
// upserts active problems (matched by (project_id, problem_type) where
// resolved_at is null) and marks rows resolved when the trigger condition
// no longer holds. Safe to call from cron or from a manual "Sync now" button.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type Detection = {
  project_id: string;
  problem_type:
    | "budget_overrun"
    | "underquoting"
    | "extension_pressure"
    | "late_internal"
    | "late_external";
  severity: "low" | "med" | "high";
  details: Record<string, unknown>;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { project_id } = (await req.json().catch(() => ({}))) as { project_id?: string };
    const sb = createServiceRoleClient();

    let projectsQ = sb
      .from("projects")
      .select("id, status, started_at, due_date")
      .neq("status", "archived");
    if (project_id) projectsQ = projectsQ.eq("id", project_id);
    const { data: projects, error: pErr } = await projectsQ;
    if (pErr) return json({ error: pErr.message }, 500);

    const detections: Detection[] = [];
    const now = Date.now();

    for (const p of projects ?? []) {
      // ---- Budget rollup
      const { data: actuals } = await sb
        .from("project_actuals_current")
        .select("planned_hours, actual_hours")
        .eq("project_id", p.id);
      const budgeted = (actuals ?? []).reduce(
        (s, r) => s + (r.planned_hours ?? 0) * 4,
        0,
      );
      const actual = (actuals ?? []).reduce(
        (s, r) => s + (r.actual_hours ?? 0) * 4,
        0,
      );

      const timelineProgress = computeTimelineProgress(p.started_at, p.due_date, now);

      // Budget overrun + underquoting
      if (budgeted > 0) {
        const overrunPct = actual / budgeted - 1;
        if (overrunPct > 0) {
          detections.push({
            project_id: p.id,
            problem_type: "budget_overrun",
            severity: overrunPct > 0.25 ? "high" : "med",
            details: {
              actual_points: round2(actual),
              budgeted_points: round2(budgeted),
              overrun_pct: round2(overrunPct),
            },
          });
        }
        if (overrunPct > 0.25 && timelineProgress >= 0.8) {
          detections.push({
            project_id: p.id,
            problem_type: "underquoting",
            severity: "med",
            details: {
              overrun_pct: round2(overrunPct),
              timeline_progress: round2(timelineProgress),
            },
          });
        }
      }

      // ---- Extension pressure (Phase 2 dependency)
      const { count: extCount } = await sb
        .from("extension_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_id", await clientIdForProject(sb, p.id))
        .in("status", ["pending_admin", "pending_owner", "approved", "auto_approved"]);
      if ((extCount ?? 0) >= 2) {
        detections.push({
          project_id: p.id,
          problem_type: "extension_pressure",
          severity: (extCount ?? 0) >= 4 ? "med" : "low",
          details: { extension_count: extCount },
        });
      }
    }

    // Upsert detections; mark active problems not present this run as resolved.
    const { data: existing } = await sb
      .from("project_problems")
      .select("id, project_id, problem_type, resolved_at")
      .is("resolved_at", null);

    const detectionKey = (project_id: string, type: string) => `${project_id}::${type}`;
    const detectionMap = new Map<string, Detection>(
      detections.map((d) => [detectionKey(d.project_id, d.problem_type), d]),
    );

    let upserted = 0;
    let resolved = 0;

    for (const det of detections) {
      const key = detectionKey(det.project_id, det.problem_type);
      const existingRow = (existing ?? []).find(
        (e) => e.project_id === det.project_id && e.problem_type === det.problem_type,
      );
      if (existingRow) {
        await sb
          .from("project_problems")
          .update({
            severity: det.severity,
            details: det.details,
            last_detected_at: new Date().toISOString(),
          })
          .eq("id", existingRow.id);
      } else {
        await sb.from("project_problems").insert({
          project_id: det.project_id,
          problem_type: det.problem_type,
          severity: det.severity,
          details: det.details,
        });
      }
      upserted += 1;
      detectionMap.delete(key);
    }

    for (const stale of existing ?? []) {
      const key = detectionKey(stale.project_id, stale.problem_type);
      if (!detectionMap.has(key)) continue; // (this branch unreachable; left for clarity)
    }
    // Resolve any active problems no longer detected.
    for (const stale of existing ?? []) {
      const stillFlagged = detections.some(
        (d) => d.project_id === stale.project_id && d.problem_type === stale.problem_type,
      );
      if (!stillFlagged) {
        await sb
          .from("project_problems")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", stale.id);
        resolved += 1;
      }
    }

    return json({ evaluated: projects?.length ?? 0, upserted, resolved });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function computeTimelineProgress(
  startedAt: string,
  dueDate: string | null,
  now: number,
): number {
  if (!dueDate) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(dueDate).getTime();
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

async function clientIdForProject(
  sb: ReturnType<typeof createServiceRoleClient>,
  projectId: string,
): Promise<string> {
  const { data } = await sb.from("projects").select("client_id").eq("id", projectId).single();
  return (data?.client_id as string | null) ?? "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
