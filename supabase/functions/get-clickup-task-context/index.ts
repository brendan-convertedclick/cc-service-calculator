// supabase/functions/get-clickup-task-context/index.ts
//
// Request:  POST { task_id: string }
// Response: 200 { context: { ... } }
//
// The original context an approver needs to judge an extension or revision
// request: what the task actually asked for, what it was budgeted at, and how
// much has been burned against it. Read live from ClickUp rather than
// snapshotted at request time, so it works for rows created before this
// existed and never goes stale.
//
// Sprint points are ClickUp's native `points` field (see _shared/clickup.ts);
// a list-level "Sprint Points" custom field is the fallback for lists without
// the Sprints ClickApp.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

const POINT_TO_MIN = 15;
const MS_PER_POINT = POINT_TO_MIN * 60_000;

type CuTask = {
  id: string;
  name: string;
  text_content?: string | null;
  description?: string | null;
  url?: string;
  status?: { status?: string };
  points?: number | null;
  time_estimate?: number | null;
  time_spent?: number | null;
  due_date?: string | null;
  date_created?: string | null;
  list?: { name?: string };
  assignees?: Array<{ username?: string }>;
  custom_fields?: Array<{ name: string; value?: unknown }>;
};

function extractSprintPoints(
  nativePoints: number | null | undefined,
  fields?: Array<{ name: string; value?: unknown }>,
): number | null {
  if (typeof nativePoints === "number" && Number.isFinite(nativePoints)) return nativePoints;
  const f = fields?.find((x) => x.name.trim().toLowerCase() === "sprint points");
  if (!f || f.value === undefined || f.value === null) return null;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : null;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { task_id } = (await req.json()) as { task_id?: string };
    if (!task_id) return json({ error: "task_id required" }, 400);

    // Authenticate — this exposes client task detail, so it isn't public.
    const supabase = createUserClient(req);
    const callerEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
    if (!callerEmail) return json({ error: "Not authenticated" }, 401);

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const res = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      return json({ error: `ClickUp task ${res.status}: ${await res.text()}` }, 502);
    }
    const t = (await res.json()) as CuTask;

    const points = extractSprintPoints(t.points, t.custom_fields);
    const timeSpentMs = toNum(t.time_spent) ?? 0;
    const timeEstimateMs = toNum(t.time_estimate);

    return json({
      context: {
        id: t.id,
        name: t.name,
        url: t.url ?? `https://app.clickup.com/t/${t.id}`,
        description: (t.text_content ?? t.description ?? "").trim() || null,
        status: t.status?.status ?? null,
        list_name: t.list?.name ?? null,
        assignees: (t.assignees ?? []).map((a) => a.username).filter(Boolean),
        due_date: toNum(t.due_date),
        date_created: toNum(t.date_created),
        // Budget: whichever of points / time estimate the task actually carries.
        original_points: points,
        time_estimate_ms: timeEstimateMs,
        // Burn so far. points_consumed lets an approver compare like with like
        // even when the task was budgeted in points (1pt = 15 min).
        time_spent_ms: timeSpentMs,
        points_consumed: Math.round((timeSpentMs / MS_PER_POINT) * 100) / 100,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
