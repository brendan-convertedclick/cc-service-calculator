import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type View = "year" | "month" | "week";

interface RequestBody {
  view: View;
  date: string;
  clickup_user_id?: number;
}

function periodRange(view: View, date: string): [number, number] {
  const d = new Date(date);
  if (view === "year") {
    return [new Date(d.getFullYear(), 0, 1).getTime(), new Date(d.getFullYear() + 1, 0, 1).getTime()];
  }
  if (view === "month") {
    return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  }
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 7);
  return [mon.getTime(), sun.getTime()];
}

function toBucket(view: View, tsMs: number): string {
  const d = new Date(tsMs);
  if (view === "year") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (view === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

function periodLabel(view: View, date: string): string {
  const d = new Date(date);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return `${mon.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${fri.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
}

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

interface ClickupTask {
  id: string;
  name: string;
  points: number | null;
  date_done: string | null;
  date_created: string;
  assignees: Array<{ id: number }>;
  tags?: Array<{ name: string }>;
  status: { status: string; type: string };
}

function getTaskType(task: ClickupTask): "external" | "internal" {
  return (task.tags ?? []).some((t) => t.name.trim().toLowerCase() === "internal")
    ? "internal"
    : "external";
}

async function fetchAllTasks(
  baseUrl: string,
  params: URLSearchParams,
  headers: Record<string, string>,
): Promise<ClickupTask[]> {
  const all: ClickupTask[] = [];
  let page = 0;
  while (page < 20) {
    params.set("page", String(page));
    const res = await fetch(`${baseUrl}?${params}`, { headers });
    if (!res.ok) throw new Error(`ClickUp tasks ${res.status}: ${await res.text()}`);
    const body = await res.json() as { tasks: ClickupTask[]; last_page?: boolean };
    all.push(...(body.tasks ?? []));
    if (body.last_page || (body.tasks ?? []).length === 0) break;
    page++;
  }
  return all;
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
      .select("clickup_enabled, clickup_workspace_id, clickup_clients_space_id, zar_per_point")
      .eq("id", 1)
      .single();

    if (!settings?.clickup_enabled) return json({ error: "ClickUp is disabled in Settings" }, 400);
    if (!settings?.clickup_workspace_id) return json({ error: "ClickUp workspace ID not configured" }, 400);
    if (!settings?.clickup_clients_space_id) return json({ error: "ClickUp clients space not configured" }, 400);

    const zarPerPoint: number = settings.zar_per_point ?? 500;
    const [startMs, endMs] = periodRange(view, date);
    const CU = { Authorization: clickupPat, "Content-Type": "application/json" };

    const completedParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_done_gt: String(startMs),
      date_done_lt: String(endMs),
    });
    completedParams.append("space_ids[]", String(settings.clickup_clients_space_id));
    if (clickup_user_id) completedParams.append("assignees[]", String(clickup_user_id));

    const createdParams = new URLSearchParams({
      include_closed: "true",
      subtasks: "true",
      date_created_gt: String(startMs),
      date_created_lt: String(endMs),
    });
    createdParams.append("space_ids[]", String(settings.clickup_clients_space_id));
    if (clickup_user_id) createdParams.append("assignees[]", String(clickup_user_id));

    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    const base = `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}`;
    const [completedTasks, createdTasks, timeRes] = await Promise.all([
      fetchAllTasks(`${base}/task`, completedParams, CU),
      fetchAllTasks(`${base}/task`, createdParams, CU),
      fetch(`${base}/time_entries?${timeParams}`, { headers: CU }),
    ]);

    if (!timeRes.ok) return json({ error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` }, 502);

    const { data: timeData } = await timeRes.json() as {
      data: Array<{ duration: string; start: string; user: { id: number } }>;
    };

    type Acc = {
      externalCompleted: number; externalCreated: number;
      internalCompleted: number; internalCreated: number;
      cycleDaysSum: number; cycleCount: number;
      valueZar: number;
    };
    const memberAcc = new Map<number, Acc>();
    const hoursAcc = new Map<number, number>();

    type BucketAcc = Map<number, { externalCompleted: number; internalCompleted: number; valueZar: number; cycleDaysSum: number; cycleCount: number }>;
    const bucketMap = new Map<string, BucketAcc>();

    function ensureMember(id: number): Acc {
      if (!memberAcc.has(id)) {
        memberAcc.set(id, { externalCompleted: 0, externalCreated: 0, internalCompleted: 0, internalCreated: 0, cycleDaysSum: 0, cycleCount: 0, valueZar: 0 });
      }
      return memberAcc.get(id)!;
    }

    function ensureBucketMember(bucket: string, userId: number) {
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
      const bm = bucketMap.get(bucket)!;
      if (!bm.has(userId)) bm.set(userId, { externalCompleted: 0, internalCompleted: 0, valueZar: 0, cycleDaysSum: 0, cycleCount: 0 });
      return bm.get(userId)!;
    }

    for (const task of completedTasks ?? []) {
      if (!task.date_done) continue;
      const closedMs = Number(task.date_done);
      const createdMs = Number(task.date_created);
      const cycleDays = (closedMs - createdMs) / 86_400_000;
      const taskType = getTaskType(task);
      const pts = task.points ?? 0;
      const valueZar = pts * zarPerPoint;
      const bucket = toBucket(view, closedMs);

      for (const a of task.assignees ?? []) {
        const acc = ensureMember(a.id);
        const bAcc = ensureBucketMember(bucket, a.id);
        if (taskType === "external") {
          acc.externalCompleted++;
          bAcc.externalCompleted++;
        } else {
          acc.internalCompleted++;
          bAcc.internalCompleted++;
        }
        acc.cycleDaysSum += cycleDays;
        acc.cycleCount++;
        acc.valueZar += valueZar;
        bAcc.cycleDaysSum += cycleDays;
        bAcc.cycleCount++;
        bAcc.valueZar += valueZar;
      }
    }

    for (const task of createdTasks ?? []) {
      const taskType = getTaskType(task);
      for (const a of task.assignees ?? []) {
        const acc = ensureMember(a.id);
        if (taskType === "external") acc.externalCreated++;
        else acc.internalCreated++;
      }
    }

    for (const entry of timeData ?? []) {
      const hours = Number(entry.duration) / 3_600_000;
      hoursAcc.set(entry.user.id, (hoursAcc.get(entry.user.id) ?? 0) + hours);
    }

    const days = Math.max(workingDays(startMs, endMs), 1);

    const members = Array.from(memberAcc.entries()).map(([userId, acc]) => {
      const humanHours = Math.round((hoursAcc.get(userId) ?? 0) * 10) / 10;
      const totalCompleted = acc.externalCompleted + acc.internalCompleted;
      return {
        userId,
        externalCompleted: acc.externalCompleted,
        externalCreated: acc.externalCreated,
        externalRate: acc.externalCreated > 0 ? acc.externalCompleted / acc.externalCreated : 0,
        internalCompleted: acc.internalCompleted,
        internalCreated: acc.internalCreated,
        internalRate: acc.internalCreated > 0 ? acc.internalCompleted / acc.internalCreated : 0,
        tasksCompletedInPeriod: totalCompleted,
        avgCycleDays: acc.cycleCount > 0 ? Math.round((acc.cycleDaysSum / acc.cycleCount) * 10) / 10 : 0,
        tasksPerWorkingDay: Math.round((totalCompleted / days) * 10) / 10,
        totalValueZar: acc.valueZar,
        humanHours,
        yieldPerHour: humanHours > 0 ? Math.round(acc.valueZar / humanHours) : 0,
      };
    });

    const buckets = Array.from(bucketMap.entries()).map(([bucket, bm]) => ({
      bucket,
      members: Array.from(bm.entries()).map(([userId, b]) => ({
        userId,
        externalCompleted: b.externalCompleted,
        internalCompleted: b.internalCompleted,
        valueZar: b.valueZar,
        avgCycleDays: b.cycleCount > 0 ? Math.round((b.cycleDaysSum / b.cycleCount) * 10) / 10 : 0,
      })),
    }));

    const totalExtCompleted = members.reduce((s, m) => s + m.externalCompleted, 0);
    const totalExtCreated = members.reduce((s, m) => s + m.externalCreated, 0);
    const totalIntCompleted = members.reduce((s, m) => s + m.internalCompleted, 0);
    const totalIntCreated = members.reduce((s, m) => s + m.internalCreated, 0);
    const totalCompleted = totalExtCompleted + totalIntCompleted;
    const totalCycleDaysSum = members.reduce((s, m) => s + m.avgCycleDays * m.tasksCompletedInPeriod, 0);
    const totalValueZar = members.reduce((s, m) => s + m.totalValueZar, 0);
    const totalHumanHours = members.reduce((s, m) => s + m.humanHours, 0);

    return json({
      meta: {
        periodLabel: periodLabel(view, date),
        workingDays: days,
        overallExternalRate: totalExtCreated > 0 ? totalExtCompleted / totalExtCreated : 0,
        overallInternalRate: totalIntCreated > 0 ? totalIntCompleted / totalIntCreated : 0,
        avgCycleDays: totalCompleted > 0 ? Math.round((totalCycleDaysSum / totalCompleted) * 10) / 10 : 0,
        tasksPerWorkingDay: Math.round((totalCompleted / days) * 10) / 10,
        totalValueZar,
        avgYieldPerHour: totalHumanHours > 0 ? Math.round(totalValueZar / totalHumanHours) : 0,
        zarPerPoint,
      },
      members,
      buckets,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
