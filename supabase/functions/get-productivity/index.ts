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
  overheadEntries: TimeEntry[];
  pointModifications: PointModification[];
  meta: {
    periodLabel: string;
    totalPoints: number;
    totalHours: number;
    totalOverheadHours: number;
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

    const { data: ongoingRows } = await supabase
      .from("ongoing_tasks")
      .select("clickup_task_id, billable")
      .is("archived_at", null);
    // Map: ClickUp task id -> resolved billable (null override coerced to false).
    const ongoingBillable = new Map<string, boolean>(
      (ongoingRows ?? []).map((r) => [r.clickup_task_id, r.billable ?? false]),
    );

    const [startMs, endMs] = periodRange(view, date);
    const CU_HEADERS = { Authorization: clickupPat, "Content-Type": "application/json" };

    type CUTask = {
      id: string;
      name: string;
      points: number | null;
      date_done: string;
      assignees: Array<{ id: number }>;
      creator: { id: number } | null;
    };

    async function fetchAllTasks(params: URLSearchParams): Promise<CUTask[]> {
      const all: CUTask[] = [];
      let page = 0;
      const taskBase = `https://api.clickup.com/api/v2/team/${settings!.clickup_workspace_id}/task`;
      while (page < 20) {
        params.set("page", String(page));
        const res = await fetch(`${taskBase}?${params}`, { headers: CU_HEADERS });
        if (!res.ok) throw new Error(`ClickUp tasks ${res.status}: ${await res.text()}`);
        const body = await res.json() as { tasks: CUTask[]; last_page?: boolean };
        all.push(...(body.tasks ?? []));
        if (body.last_page || (body.tasks ?? []).length === 0) break;
        page++;
      }
      return all;
    }

    // Build task query params
    const taskParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_done_gt: String(startMs),
      date_done_lt: String(endMs),
    });
    // Filter to the Clients space; /space/{id}/task is not a valid ClickUp v2 endpoint —
    // use /team/{id}/task with space_ids[] instead
    taskParams.append("space_ids[]", String(settings.clickup_clients_space_id));
    if (clickup_user_id) taskParams.append("assignees[]", String(clickup_user_id));

    // Build time entries query params
    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    // Parallel fetch — tasks are paginated, time entries are not
    const [allTasks, timeRes] = await Promise.all([
      fetchAllTasks(taskParams),
      fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
        { headers: CU_HEADERS },
      ),
    ]);

    if (!timeRes.ok) return json({ error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` }, 502);

    const tasksBody = { tasks: allTasks };
    const timeBody = await timeRes.json() as {
      data: Array<{
        duration: string; // ms as string
        start: string;    // unix ms as string
        billable?: boolean;
        user: { id: number };
        task?: { id: string };
      }>;
    };

    // Internal-meeting ClickUp tasks live in the internal list but are not
    // ongoing_tasks rows, so without this they'd fall through to "assume
    // billable" below and corrupt client actuals/margin/invoice reports.
    // Scoped to the exact task ids seen in THIS period's time entries rather
    // than fetched unbounded (PostgREST's default max-rows of 1000 silently
    // truncates an unordered select once internal_meetings grows past it) or
    // by a date-window guess (a time entry logged late against an
    // older-starting meeting would fall outside a starts_at window and be
    // misclassified as billable — the exact corruption this fix exists to
    // prevent).
    const periodTaskIds = Array.from(
      new Set((timeBody.data ?? []).map((e) => e.task?.id).filter((id): id is string => !!id)),
    );
    // BOTH tables, not either one. Since 0099 every attendee gets their OWN
    // ClickUp task (ClickUp splits sprint points per assignee) and those live
    // in internal_meeting_tasks; internal_meetings.clickup_task_id only ever
    // holds the ORGANISER's. Reading only the parent missed 25 of the first 46
    // meeting tasks, which then fell through to "assume billable" and inflated
    // every margin and invoice figure that touched them. Reading only the
    // child would drop the 3 meetings created before 0099, which have no
    // child rows at all.
    const [meetingRes, meetingTaskRes] = periodTaskIds.length > 0
      ? await Promise.all([
        supabase.from("internal_meetings").select("clickup_task_id").in("clickup_task_id", periodTaskIds),
        supabase.from("internal_meeting_tasks").select("clickup_task_id").in("clickup_task_id", periodTaskIds),
      ])
      : [{ data: [] }, { data: [] }];
    const meetingTaskIds = new Set<string>(
      [
        ...((meetingRes.data ?? []) as Array<{ clickup_task_id: string | null }>),
        ...((meetingTaskRes.data ?? []) as Array<{ clickup_task_id: string | null }>),
      ].map((r) => r.clickup_task_id).filter((id): id is string => !!id),
    );

    // Aggregate sprint points by bucket + userId
    const sprintMap = new Map<string, SprintPoint>();
    for (const task of tasksBody.tasks ?? []) {
      const pts = task.points ?? 0;
      if (pts === 0) continue;
      const bucket = toBucket(view, Number(task.date_done));
      const assigneeIds = new Set((task.assignees ?? []).map((a) => a.id));

      for (const assignee of task.assignees ?? []) {
        const isSelfCreated = task.creator != null && task.creator.id === assignee.id;
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

    // Aggregate time entries by bucket + userId — split delivery vs overhead
    const timeMap = new Map<string, TimeEntry>();
    const overheadMap = new Map<string, TimeEntry>();
    for (const entry of timeBody.data ?? []) {
      const hours = Number(entry.duration) / 3_600_000;
      const bucket = toBucket(view, Number(entry.start));
      const key = `${bucket}::${entry.user.id}`;
      // Classification priority:
      //  1. If ClickUp returned billable on the entry, trust it (operator
      //     can override per-entry in ClickUp itself).
      //  2. Else if the task is in ongoing_tasks, use that row's resolved
      //     billable (live tasks may be billable; overhead/admin/meetings
      //     are non-billable per the template's billable flag).
      //  3. Else assume billable — project/sprint work outside ongoing_tasks
      //     is billable by default.
      const fromDb = entry.task?.id ? ongoingBillable.get(entry.task.id) : undefined;
      // Meeting tasks are always overhead, checked ahead of (not merged into)
      // ongoingBillable — ClickUp's own billable flag would otherwise win.
      const isMeeting = entry.task?.id ? meetingTaskIds.has(entry.task.id) : false;
      const isBillable = isMeeting
        ? false
        : typeof entry.billable === "boolean"
        ? entry.billable
        : (fromDb !== undefined ? fromDb : true);
      const target = isBillable ? timeMap : overheadMap;
      const existing = target.get(key);
      if (existing) {
        existing.hours += hours;
      } else {
        target.set(key, { bucket, userId: entry.user.id, hours });
      }
    }

    // Fetch point modification history for month/week views (skip for year)
    const pointModifications: PointModification[] = [];
    if (view !== "year") {
      const tasksWithPoints = (tasksBody.tasks ?? []).filter((t) => (t.points ?? 0) > 0);
      const HISTORY_CHUNK = 10;

      for (let i = 0; i < tasksWithPoints.length; i += HISTORY_CHUNK) {
        const chunk = tasksWithPoints.slice(i, i + HISTORY_CHUNK);
        const results = await Promise.allSettled(
          chunk.map(async (task) => {
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
                oldPoints: entry.before != null ? Number(entry.before) : 0,
                newPoints: entry.after != null ? Number(entry.after) : 0,
                changedAt: entry.date,
              });
            }
            return modifications;
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            pointModifications.push(...r.value);
          }
          // silently skip rejected (failed history fetches)
        }
      }
    }

    const sprintPoints = Array.from(sprintMap.values());
    const timeEntries = Array.from(timeMap.values());
    const overheadEntries = Array.from(overheadMap.values());

    const totalPoints = sprintPoints.reduce((s, r) => s + r.points, 0);
    const totalHours = timeEntries.reduce((s, r) => s + r.hours, 0);
    const totalOverheadHours = overheadEntries.reduce((s, r) => s + r.hours, 0);
    const days = Math.max(workingDays(startMs, endMs), 1);
    const activeContributors = new Set([
      ...sprintPoints.map((r) => r.userId),
      ...timeEntries.map((r) => r.userId),
      ...overheadEntries.map((r) => r.userId),
    ]).size;

    const result: ResponseBody = {
      sprintPoints,
      timeEntries,
      overheadEntries,
      pointModifications,
      meta: {
        periodLabel: periodLabel(view, date),
        totalPoints,
        totalHours: Math.round(totalHours * 10) / 10,
        totalOverheadHours: Math.round(totalOverheadHours * 10) / 10,
        dailyAvg: Math.round((totalPoints / days) * 10) / 10,
        activeContributors,
      },
    };

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
