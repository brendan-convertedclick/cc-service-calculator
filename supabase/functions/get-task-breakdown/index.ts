// supabase/functions/get-task-breakdown/index.ts
//
// Returns per-task hours bucketed by date and user for the
// Productivity → Tasks tab. Two consumption modes:
//   - "By Person": one row per (bucket, userId, taskId) — render as a
//     stacked bar per person where the stacks are tasks.
//   - "By Task":   filter client-side to selected taskIds — render as a
//     stacked bar per bucket where the stacks are tasks (or per person).
//
// Pulls from ClickUp /team/{id}/time_entries which already includes
// task.id and task.name on each entry.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type View = "year" | "month" | "week" | "day";

interface RequestBody {
  view: View;
  date: string;
  clickup_user_id?: number;
}

interface TaskHours {
  bucket: string;
  userId: number;
  taskId: string;
  taskName: string;
  hours: number;
}

function periodRange(view: View, date: string): [number, number] {
  const d = new Date(date);
  if (view === "year") {
    return [
      new Date(d.getFullYear(), 0, 1).getTime(),
      new Date(d.getFullYear() + 1, 0, 1).getTime(),
    ];
  }
  if (view === "month") {
    return [
      new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    ];
  }
  if (view === "day") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return [start.getTime(), end.getTime()];
  }
  // week: Mon–Sun
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
  if (view === "year") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (view === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (view === "day") {
    // hour buckets so a day view still has columns
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

function periodLabel(view: View, date: string): string {
  const d = new Date(date);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") {
    return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  }
  if (view === "day") {
    return d.toLocaleDateString("en-ZA", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${sun.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as RequestBody;
    const { view, date, clickup_user_id } = body;
    if (!view || !date) return json({ error: "view and date required" }, 400);

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const supabase = createServiceRoleClient();
    const { data: settings } = await supabase
      .from("settings")
      .select("clickup_enabled, clickup_workspace_id")
      .eq("id", 1)
      .single();
    if (!settings?.clickup_enabled) {
      return json({ error: "ClickUp disabled in Settings" }, 400);
    }
    if (!settings?.clickup_workspace_id) {
      return json({ error: "ClickUp workspace ID not configured" }, 400);
    }

    const [startMs, endMs] = periodRange(view, date);

    const timeParams = new URLSearchParams({
      start_date: String(startMs),
      end_date: String(endMs),
    });
    if (clickup_user_id) timeParams.append("assignee", String(clickup_user_id));

    const timeRes = await fetch(
      `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/time_entries?${timeParams}`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!timeRes.ok) {
      return json(
        { error: `ClickUp time ${timeRes.status}: ${await timeRes.text()}` },
        502,
      );
    }
    const timeBody = (await timeRes.json()) as {
      data: Array<{
        duration: string;
        start: string;
        user: { id: number };
        task?: { id: string; name?: string };
        task_location?: { list_name?: string; folder_name?: string };
      }>;
    };

    // Aggregate by (bucket, userId, taskId).
    const map = new Map<string, TaskHours>();
    for (const e of timeBody.data ?? []) {
      const hours = Number(e.duration) / 3_600_000;
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const bucket = toBucket(view, Number(e.start));
      const taskId = e.task?.id ?? "untracked";
      const taskName = e.task?.name ?? "(no task)";
      const key = `${bucket}::${e.user.id}::${taskId}`;
      const existing = map.get(key);
      if (existing) {
        existing.hours += hours;
      } else {
        map.set(key, {
          bucket,
          userId: e.user.id,
          taskId,
          taskName,
          hours,
        });
      }
    }

    // Round once at the end so totals don't drift.
    const entries: TaskHours[] = Array.from(map.values()).map((r) => ({
      ...r,
      hours: Math.round(r.hours * 100) / 100,
    }));

    // Build list of distinct tasks (for multi-select picker).
    const taskById = new Map<string, string>();
    for (const r of entries) taskById.set(r.taskId, r.taskName);
    const tasks = Array.from(taskById.entries()).map(([id, name]) => ({ id, name }));

    return json({
      entries,
      tasks,
      meta: {
        periodLabel: periodLabel(view, date),
        totalHours: Math.round(entries.reduce((s, r) => s + r.hours, 0) * 10) / 10,
        taskCount: tasks.length,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
