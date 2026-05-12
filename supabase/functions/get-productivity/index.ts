// supabase/functions/get-productivity/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type View = "year" | "month" | "week";

interface RequestBody {
  view: View;
  date: string; // ISO date string, e.g. "2026-05-12"
  clickup_user_id?: number;
}

interface SprintPoint {
  bucket: string;
  userId: number;
  points: number;
  selfCreatedPoints: number;
  businessCreatedPoints: number;
}

interface TimeEntry {
  bucket: string;
  userId: number;
  hours: number;
}

interface PointModification {
  bucket: string;
  taskId: string;
  taskName: string;
  userId: number;
  oldPoints: number;
  newPoints: number;
  changedAt: string;
}

interface ResponseBody {
  sprintPoints: SprintPoint[];
  timeEntries: TimeEntry[];
  pointModifications: PointModification[];
  meta: {
    periodLabel: string;
    totalPoints: number;
    totalHours: number;
    dailyAvg: number;
    activeContributors: number;
  };
}

/** Returns [startMs, endMs] for the period containing `date` based on `view` */
function periodRange(view: View, date: string): [number, number] {
  const d = new Date(date);
  if (view === "year") {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear() + 1, 0, 1);
    return [start.getTime(), end.getTime()];
  }
  if (view === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return [start.getTime(), end.getTime()];
  }
  // week: Mon–Sun of the ISO week containing date
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return [mon.getTime(), sun.getTime()];
}

/** Returns the bucket string for a given timestamp and view */
function toBucket(view: View, tsMs: number): string {
  const d = new Date(tsMs);
  if (view === "year") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (view === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // week: return Mon/Tue/Wed/Thu/Fri/Sat/Sun
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

/** Returns a human-readable period label */
function periodLabel(view: View, date: string): string {
  const d = new Date(date);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") {
    return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  }
  // week: find Monday
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return `${mon.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${fri.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Count working days (Mon–Fri) in the period */
function workingDays(startMs: number, endMs: number): number {
  let count = 0;
  const cur = new Date(startMs);
  while (cur.getTime() < endMs) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json() as RequestBody;
    const { view, date, clickup_user_id } = body;
    if (!view || !date) return json({ error: "view and date required" }, 400);

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const supabase = createServiceRoleClient();
    const { data: settings } = await supabase
      .from("settings")
      .select("clickup_enabled, clickup_workspace_id, clickup_clients_space_id")
      .eq("id", 1)
      .single();

    if (!settings?.clickup_enabled) return json({ error: "ClickUp is disabled in Settings" }, 400);
    if (!settings?.clickup_workspace_id) return json({ error: "ClickUp workspace ID not configured" }, 400);
    if (!settings?.clickup_clients_space_id) return json({ error: "ClickUp clients space not configured" }, 400);

    const [startMs, endMs] = periodRange(view, date);
    const CU_HEADERS = { Authorization: clickupPat, "Content-Type": "application/json" };

    // Build task query params
    const taskParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_done_gt: String(startMs),
      date_done_lt: String(endMs),
      page: "0",
    });
    if (clickup_user_id) taskParams.append("assignees[]", String(clickup_user_id));

    // Build time entries query params
    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    // Parallel fetch
    const [tasksRes, timeRes] = await Promise.all([
      fetch(
        `https://api.clickup.com/api/v2/space/${settings.clickup_clients_space_id}/task?${taskParams}`,
        { headers: CU_HEADERS },
      ),
      fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: CU_HEADERS },
      ),
    ]);

    if (!tasksRes.ok) return json({ error: `ClickUp tasks ${tasksRes.status}: ${await tasksRes.text()}` }, 502);
    if (!timeRes.ok) return json({ error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` }, 502);

    const tasksBody = await tasksRes.json() as {
      tasks: Array<{
        id: string;
        name: string;
        points: number | null;
        date_done: string; // unix ms as string
        assignees: Array<{ id: number }>;
        creator: { id: number } | null;
      }>;
    };
    const timeBody = await timeRes.json() as {
      data: Array<{
        duration: string; // ms as string
        start: string;    // unix ms as string
        user: { id: number };
      }>;
    };

    // Aggregate sprint points by bucket + userId
    const sprintMap = new Map<string, SprintPoint>();
    for (const task of tasksBody.tasks ?? []) {
      const pts = task.points ?? 0;
      if (pts === 0) continue;
      const bucket = toBucket(view, Number(task.date_done));
      const assigneeIds = new Set((task.assignees ?? []).map((a) => a.id));
      const isSelfCreated = task.creator != null && assigneeIds.has(task.creator.id);

      for (const assignee of task.assignees ?? []) {
        const key = `${bucket}::${assignee.id}`;
        const existing = sprintMap.get(key);
        if (existing) {
          existing.points += pts;
          if (isSelfCreated) {
            existing.selfCreatedPoints += pts;
          } else {
            existing.businessCreatedPoints += pts;
          }
        } else {
          sprintMap.set(key, {
            bucket,
            userId: assignee.id,
            points: pts,
            selfCreatedPoints: isSelfCreated ? pts : 0,
            businessCreatedPoints: isSelfCreated ? 0 : pts,
          });
        }
      }
    }

    // Aggregate time entries by bucket + userId
    const timeMap = new Map<string, TimeEntry>();
    for (const entry of timeBody.data ?? []) {
      const hours = Number(entry.duration) / 3_600_000;
      const bucket = toBucket(view, Number(entry.start));
      const key = `${bucket}::${entry.user.id}`;
      const existing = timeMap.get(key);
      if (existing) {
        existing.hours += hours;
      } else {
        timeMap.set(key, { bucket, userId: entry.user.id, hours });
      }
    }

    // Fetch point modification history for month/week views (skip for year)
    let pointModifications: PointModification[] = [];
    if (view !== "year") {
      const tasksWithPoints = (tasksBody.tasks ?? []).filter((t) => (t.points ?? 0) > 0);
      const historyResults = await Promise.allSettled(
        tasksWithPoints.map(async (task) => {
          const assigneeIds = new Set((task.assignees ?? []).map((a) => a.id));
          const histRes = await fetch(
            `https://api.clickup.com/api/v2/task/${task.id}/history?reverse=true&limit=50`,
            { headers: CU_HEADERS },
          );
          if (!histRes.ok) {
            throw new Error(`history ${task.id} ${histRes.status}`);
          }
          const histBody = await histRes.json() as {
            history: Array<{
              field: string;
              user: { id: number };
              date: string;
              before: string | null;
              after: string | null;
            }>;
          };
          const modifications: PointModification[] = [];
          for (const entry of histBody.history ?? []) {
            if (entry.field !== "points") continue;
            if (!assigneeIds.has(entry.user.id)) continue;
            const entryMs = Number(entry.date);
            if (entryMs < startMs || entryMs >= endMs) continue;
            modifications.push({
              bucket: toBucket(view, entryMs),
              taskId: task.id,
              taskName: task.name,
              userId: entry.user.id,
              oldPoints: Number(entry.before) || 0,
              newPoints: Number(entry.after) || 0,
              changedAt: entry.date,
            });
          }
          return modifications;
        }),
      );

      for (const result of historyResults) {
        if (result.status === "fulfilled") {
          pointModifications = pointModifications.concat(result.value);
        }
        // silently skip rejected (failed history fetches)
      }
    }

    const sprintPoints = Array.from(sprintMap.values());
    const timeEntries = Array.from(timeMap.values());

    const totalPoints = sprintPoints.reduce((s, r) => s + r.points, 0);
    const totalHours = timeEntries.reduce((s, r) => s + r.hours, 0);
    const days = Math.max(workingDays(startMs, endMs), 1);
    const activeContributors = new Set([
      ...sprintPoints.map((r) => r.userId),
      ...timeEntries.map((r) => r.userId),
    ]).size;

    const result: ResponseBody = {
      sprintPoints,
      timeEntries,
      pointModifications,
      meta: {
        periodLabel: periodLabel(view, date),
        totalPoints,
        totalHours: Math.round(totalHours * 10) / 10,
        dailyAvg: Math.round((totalPoints / days) * 10) / 10,
        activeContributors,
      },
    };

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
