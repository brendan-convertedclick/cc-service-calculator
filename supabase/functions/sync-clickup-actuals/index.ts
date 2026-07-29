// supabase/functions/sync-clickup-actuals/index.ts
//
// Invoked on a schedule (pg_cron → net.http_post, see migration 0011).
//
// For every in_progress project:
//   - Read the latest snapshot per child task from project_actuals_current
//     (the view added in migration 0013). This gives us the task IDs plus
//     the immutable-in-practice fields (planned_hours, dept_id) we need to
//     carry forward into the new row.
//   - Fetch each child ClickUp task's status
//   - Fetch each child ClickUp task's time entries, sum duration → hours
//   - INSERT a fresh row into project_actuals for this tick. Append-only —
//     no update-in-place — so every prior snapshot is retained for
//     burn-over-time analysis.
//   - If every child's status resolves to complete/closed/done, mark the
//     project completed_at=now(), status='completed'.
//
// Uses the service_role key (bypasses anon auth) so it can read/write any
// project_actuals row without a user session.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { collectProvisionedActuals } from "../_shared/retainer-actuals-logic.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const supabase = createServiceRoleClient();

    // Optional body: { project_id } to force-sync a specific project
    // regardless of status (used by the "Sync now" button).
    let requestedProjectId: string | null = null;
    try {
      const body = await req.json();
      requestedProjectId = body?.project_id ?? null;
    } catch { /* empty body from pg_cron is fine */ }

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled || !clickupPat) {
      return json({ skipped: "clickup disabled or CLICKUP_PAT not set" });
    }

    const CU = {
      headers: {
        Authorization: clickupPat,
        "Content-Type": "application/json",
      },
    };

    let projectsQuery = supabase.from("projects").select("*");
    if (requestedProjectId) {
      projectsQuery = projectsQuery.eq("id", requestedProjectId);
    } else {
      projectsQuery = projectsQuery.eq("status", "in_progress");
    }
    const { data: projects } = await projectsQuery;

    // Bulk-fetch all current actuals for every in-progress project in a
    // single round-trip, then group in JS. This replaces a per-project
    // query (N+1: one projects fetch + one actuals fetch per project).
    type CurrentActual = {
      clickup_task_id: string;
      dept_id: string | null;
      planned_hours: number;
      project_id: string;
    };
    const actualsByProject = new Map<string, CurrentActual[]>();
    const projectIds = (projects ?? []).map((p) => p.id);
    if (projectIds.length > 0) {
      const { data: allActuals } = await supabase
        // deno-lint-ignore no-explicit-any
        .from("project_actuals_current" as any)
        .select("*")
        .in("project_id", projectIds);
      for (const a of (allActuals ?? []) as CurrentActual[]) {
        const list = actualsByProject.get(a.project_id) ?? [];
        list.push(a);
        actualsByProject.set(a.project_id, list);
      }
    }

    // Phase 8: retainer provisioned tasks are recorded in provisioned_tasks but
    // never seeded into project_actuals, so their ClickUp time never enters the
    // burn pipeline. Pull the current-period task IDs here and fold them into
    // each project's actuals set below. First sync inserts a project_actuals
    // row; later syncs carry them forward via project_actuals_current.
    type ProvRow = {
      clickup_task_ids: string[] | null;
      period_start: string;
      period_end: string;
      // recurring_service_id is a NOT NULL to-one FK (migration 0058) →
      // PostgREST returns a single object here, never an array.
      retainer_recurring_services: { points_per_occurrence: number } | null;
    };
    const provisionedByProject = new Map<
      string,
      Array<{ clickup_task_ids: string[]; period_start: string; period_end: string; points_per_occurrence: number | null }>
    >();
    if (projectIds.length > 0) {
      const { data: provisioned, error: provErr } = await supabase
        // deno-lint-ignore no-explicit-any
        .from("provisioned_tasks" as any)
        .select(
          "project_id, clickup_task_ids, period_start, period_end, retainer_recurring_services(points_per_occurrence)",
        )
        .in("project_id", projectIds);
      if (provErr) console.error("provisioned_tasks fetch failed:", provErr.message);
      for (const row of (provisioned ?? []) as Array<ProvRow & { project_id: string }>) {
        const list = provisionedByProject.get(row.project_id) ?? [];
        list.push({
          clickup_task_ids: row.clickup_task_ids ?? [],
          period_start: row.period_start,
          period_end: row.period_end,
          points_per_occurrence: row.retainer_recurring_services?.points_per_occurrence ?? null,
        });
        provisionedByProject.set(row.project_id, list);
      }
    }
    const todayIso = new Date().toISOString().slice(0, 10);

    let inserted = 0;
    for (const p of projects ?? []) {
      const actuals = actualsByProject.get(p.id) ?? [];

      // Fold in current-period retainer provisioned tasks not already tracked.
      const existingTaskIds = new Set(actuals.map((a) => a.clickup_task_id));
      for (const seed of collectProvisionedActuals(
        existingTaskIds,
        provisionedByProject.get(p.id) ?? [],
        todayIso,
      )) {
        actuals.push({ ...seed, project_id: p.id });
      }

      let allDone = actuals.length > 0;
      const deletedTaskIds: string[] = [];

      for (const a of actuals) {
        // Parallelize the two ClickUp calls — they're independent. Cross-task
        // and cross-project parallelization is deferred to T3.
        const [tRes, teRes] = await Promise.all([
          fetch(
            `https://api.clickup.com/api/v2/task/${a.clickup_task_id}?include_subtasks=false`,
            CU,
          ),
          fetch(
            `https://api.clickup.com/api/v2/task/${a.clickup_task_id}/time`,
            CU,
          ),
        ]);
        if (!tRes.ok) {
          // A genuine 404 = the task was deleted in ClickUp → mirror that into
          // Conductor (cleaned up below). Other errors (429/5xx/network) are
          // transient: leave the task alone and retry next tick.
          if (tRes.status === 404) deletedTaskIds.push(a.clickup_task_id);
          allDone = false;
          continue;
        }
        const task = await tRes.json();

        const timeEntries = teRes.ok ? (await teRes.json()).data : null;
        const actualHours = (timeEntries ?? []).reduce(
          (acc: number, e: { time?: number | string }) =>
            acc + Number(e.time ?? 0) / 3_600_000,
          0,
        );

        const status: string | null = task.status?.status?.toLowerCase() ?? null;
        // Retainer provisioned tasks are perpetual (live) and never close, so
        // they keep allDone=false for retainer projects — correct, by design
        // (retainers must not auto-complete mid-period).
        if (status !== "complete" && status !== "closed" && status !== "done") allDone = false;

        // Append-only insert: a brand new row per task per tick. recorded_at
        // defaults to now() via the column default added in migration 0013.
        const { error: insErr } = await supabase
          .from("project_actuals")
          .insert({
            project_id: a.project_id,
            clickup_task_id: a.clickup_task_id,
            // Capture the ClickUp task name so the UI can show it instead of
            // the opaque task id. Falls back to null if absent.
            task_name: typeof task?.name === "string" ? task.name : null,
            dept_id: a.dept_id,
            planned_hours: a.planned_hours,
            actual_hours: actualHours,
            time_entries: timeEntries,
            status_at_sync: status,
            synced_at: new Date().toISOString(),
          });
        if (insErr) throw insErr;
        inserted++;
      }

      // Delete-sync: a task deleted in ClickUp is removed from Conductor too.
      // Drop its actuals history and pull it out of its provisioned_tasks record
      // so it isn't re-seeded next tick. Only genuine 404s reach here.
      if (deletedTaskIds.length > 0) {
        await supabase
          .from("project_actuals")
          .delete()
          .eq("project_id", p.id)
          .in("clickup_task_id", deletedTaskIds);
        const { data: provRows } = await supabase
          .from("provisioned_tasks")
          .select("id, clickup_task_ids")
          .eq("project_id", p.id);
        const gone = new Set(deletedTaskIds);
        for (const row of (provRows ?? []) as Array<{ id: string; clickup_task_ids: string[] | null }>) {
          const current = row.clickup_task_ids ?? [];
          const kept = current.filter((id) => !gone.has(id));
          if (kept.length !== current.length) {
            await supabase.from("provisioned_tasks").update({ clickup_task_ids: kept }).eq("id", row.id);
          }
        }
        console.log(`[delete-sync] project ${p.id}: removed ${deletedTaskIds.length} deleted ClickUp task(s)`);
      }

      if (allDone) {
        await supabase
          .from("projects")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", p.id);
      }

      // Sync process_step_instances for this project.
      // Skip any instance the ops manager has manually overridden (manual_override=true).
      const { data: stepInstances } = await supabase
        .from("process_step_instances")
        .select("id,clickup_task_id,manual_override")
        .eq("project_id", p.id)
        .not("clickup_task_id", "is", null)
        .eq("manual_override", false);

      for (const instance of (stepInstances ?? []) as Array<{
        id: string;
        clickup_task_id: string;
        manual_override: boolean;
      }>) {
        try {
          const taskRes = await fetch(
            `https://api.clickup.com/api/v2/task/${instance.clickup_task_id}?include_subtasks=false`,
            CU,
          );
          if (!taskRes.ok) continue;
          const task = await taskRes.json();

          const statusMap: Record<string, string> = {
            "to do": "pending",
            "in progress": "in_progress",
            "complete": "done",
            "done": "done",
            "closed": "done",
            "blocked": "blocked",
          };
          const rawStatus: string = task.status?.status?.toLowerCase() ?? "";
          const mappedStatus = statusMap[rawStatus] ?? "pending";

          // time_spent is in milliseconds
          const actualHours = task.time_spent ? task.time_spent / 3_600_000 : 0;

          // start_date and date_closed are ms epoch strings in ClickUp
          const startedAt = task.start_date
            ? new Date(parseInt(task.start_date)).toISOString()
            : null;
          const completedAt = mappedStatus === "done" && task.date_closed
            ? new Date(parseInt(task.date_closed)).toISOString()
            : null;

          await supabase
            .from("process_step_instances")
            .update({
              status: mappedStatus,
              actual_hours: actualHours,
              started_at: startedAt,
              completed_at: completedAt,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", instance.id);
        } catch (e) {
          console.error(`Failed to sync step instance ${instance.id}:`, e);
          // Continue — other steps should still sync
        }
      }
    }

    // Ongoing tasks — perpetual per-person overhead tasks. Pull current
    // time entries and append a snapshot. No "all done" rollup; these
    // tasks never close.
    const { data: ongoing } = await supabase
      .from("ongoing_tasks")
      .select("id, clickup_task_id, billable")
      .is("archived_at", null);

    let ongoingInserted = 0;
    for (const ot of (ongoing ?? []) as Array<{ id: string; clickup_task_id: string; billable: boolean | null }>) {
      const teRes = await fetch(
        `https://api.clickup.com/api/v2/task/${ot.clickup_task_id}/time`,
        CU,
      );
      if (!teRes.ok) continue;
      type RawTimeEntry = { time?: number | string; billable?: boolean; [key: string]: unknown };
      const rawEntries: RawTimeEntry[] = (await teRes.json()).data ?? [];
      // ClickUp's /task/{id}/time response should include `billable` per entry,
      // but defend against omissions by falling back to the row's resolved
      // billable (or false if the row override is null — only possible on
      // ongoing_tasks rows provisioned before migration 0050).
      const taskBillableFallback = ot.billable ?? false;
      const timeEntries = rawEntries.map((e) => ({
        ...e,
        billable: e.billable ?? taskBillableFallback,
      }));
      const cumulativeHours = timeEntries.reduce(
        (acc: number, e: { time?: number | string }) =>
          acc + Number(e.time ?? 0) / 3_600_000,
        0,
      );

      const { error: insErr } = await supabase.from("ongoing_actuals").insert({
        ongoing_task_id: ot.id,
        clickup_task_id: ot.clickup_task_id,
        cumulative_hours: cumulativeHours,
        time_entries: timeEntries,
      });
      if (insErr) {
        console.error("ongoing_actuals insert failed:", insErr.message);
        continue;
      }
      ongoingInserted++;
    }

    // Brief-created tasks — refresh the last-known ClickUp status so the
    // Briefs list can show progress on handed-off work. Two sources: the
    // quick-briefed task on the brief itself, and Stage-5 scheduled
    // placement_tasks. Bounded (oldest-synced first) so a growing backlog
    // can't blow the cron out; each tick catches the stalest rows.
    let briefStatusUpdates = 0;
    const POINT_TO_MIN = 15; // keep in sync with _shared/clickup.ts
    type CuTask = {
      status?: { status?: string };
      points?: number | null;
      time_spent?: number | null;
      due_date?: string | null;
      date_closed?: string | null;
      date_done?: string | null;
    };
    const fetchTask = async (taskId: string): Promise<CuTask | null> => {
      try {
        const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}?include_subtasks=false`, CU);
        if (!res.ok) return null;
        return (await res.json()) as CuTask;
      } catch {
        return null;
      }
    };
    const statusOf = (task: CuTask | null): string | null =>
      task?.status?.status?.toLowerCase() ?? null;

    // Client-waiting clock: cumulative time a task sat in the "send to client"
    // status = the client's court. One BULK call covers up to 100 task IDs, so
    // this adds a single request per tick, not one per task. total_time.by_minute
    // is the cumulative minutes in that status across all visits.
    // Statuses that put the task in the client's court (lower-cased match).
    const CLIENT_WAIT_STATUSES = new Set(["waiting on client", "send to client"]);
    // ClickUp's bulk time-in-status wraps results under `tasks`, reports minutes
    // as `total_time_minutes`, and `status_history` ALREADY includes the current
    // status — so we sum history only (adding current_status would double-count).
    type StatusTime = { status?: string; total_time_minutes?: number };
    const fetchClientWaitMap = async (taskIds: string[]): Promise<Map<string, number>> => {
      const map = new Map<string, number>();
      if (taskIds.length === 0) return map;
      try {
        // ClickUp's bulk endpoint takes REPEATED `task_ids=` params (no []).
        const params = taskIds.map((id) => `task_ids=${encodeURIComponent(id)}`).join("&");
        const res = await fetch(
          `https://api.clickup.com/api/v2/task/bulk_time_in_status/task_ids?${params}`,
          CU,
        );
        if (!res.ok) {
          console.warn(`[client-wait] bulk time_in_status ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return map;
        }
        // The raw REST API returns the map at the TOP LEVEL ({ "<taskId>": {...} });
        // some wrappers nest it under `tasks`. Handle both, and skip any non-task
        // scalar entries (e.g. a top-level task_count) via the status_history guard.
        const body = await res.json() as Record<string, unknown> & {
          tasks?: Record<string, unknown>;
        };
        const taskMap = (body.tasks ?? body) as Record<string, { status_history?: StatusTime[] }>;
        for (const [taskId, data] of Object.entries(taskMap)) {
          if (!data || typeof data !== "object" || !Array.isArray(data.status_history)) continue;
          let minutes = 0;
          for (const e of data.status_history) {
            if (CLIENT_WAIT_STATUSES.has((e.status ?? "").toLowerCase())) {
              minutes += Number(e.total_time_minutes ?? 0);
            }
          }
          map.set(taskId, Math.round(minutes * 60_000));
        }
        console.log(
          `[client-wait] resolved ${map.size}/${taskIds.length} tasks; ` +
            `${[...map.values()].filter((v) => v > 0).length} with client-wait`,
        );
      } catch (e) {
        console.warn(`[client-wait] bulk time_in_status threw: ${e instanceof Error ? e.message : e}`);
      }
      return map;
    };

    const { data: briefTasks } = await supabase
      .from("briefs")
      .select("id, clickup_task_id, original_points, original_due_date")
      .eq("status", "briefed")
      .not("clickup_task_id", "is", null)
      .order("clickup_status_synced_at", { ascending: true, nullsFirst: true })
      .limit(60);
    const clientWaitMap = await fetchClientWaitMap(
      (briefTasks ?? []).map((b) => (b as { clickup_task_id: string }).clickup_task_id),
    );
    for (const b of (briefTasks ?? []) as Array<{ id: string; clickup_task_id: string; original_points: number | null; original_due_date: string | null }>) {
      const task = await fetchTask(b.clickup_task_id);
      const status = statusOf(task);
      if (status === null || !task) continue;
      const isComplete = status === "complete" || status === "closed" || status === "done";
      const timeSpent = Number(task.time_spent ?? 0);
      const actualHours = timeSpent ? Math.round((timeSpent / 3_600_000) * 100) / 100 : 0;
      const actualPoints = timeSpent ? Math.round((timeSpent / 60_000 / POINT_TO_MIN) * 100) / 100 : 0;
      // Estimated = the frozen original allocation (freeze it here if still null).
      let originalPoints = b.original_points != null ? Number(b.original_points) : null;
      if (originalPoints == null && task.points != null) originalPoints = task.points;
      // Original due date = accountability baseline: freeze it, and measure the
      // late flag against it (not the current, possibly-extended, task due date).
      const taskDueStr = task.due_date ? new Date(Number(task.due_date)).toISOString().slice(0, 10) : null;
      let originalDue = b.original_due_date;
      if (originalDue == null && taskDueStr != null) originalDue = taskDueStr;
      const completedMs = task.date_done ?? task.date_closed ?? null;
      // Compare on a CALENDAR-DAY basis, not exact timestamp. ClickUp date-only
      // due dates land at a fixed time-of-day (e.g. 02:00Z), so an exact
      // completedMs > dueMs comparison flags *any* same-day completion as late.
      // Late = completed on a later calendar day than the due date. This matches
      // the brief panel's date-granularity daysLate(), so list and detail agree.
      const completedDayStr = completedMs != null ? new Date(Number(completedMs)).toISOString().slice(0, 10) : null;
      const overBudget = isComplete && originalPoints != null && actualPoints > originalPoints + 0.001;
      const closedLate = isComplete && originalDue != null && completedDayStr != null && completedDayStr > originalDue;
      const patch: Record<string, unknown> = {
        clickup_task_status: status,
        clickup_status_synced_at: new Date().toISOString(),
        actual_hours: actualHours,
        actual_points: actualPoints,
        // Flags only apply once complete; clear them if a task is reopened.
        over_budget: isComplete ? overBudget : false,
        closed_late: isComplete ? closedLate : false,
        completed_at: isComplete && completedMs ? new Date(Number(completedMs)).toISOString() : null,
      };
      if (b.original_points == null && originalPoints != null) patch.original_points = originalPoints;
      if (b.original_due_date == null && originalDue != null) patch.original_due_date = originalDue;
      // Client-waiting clock (time in "send to client"). Only patch when the bulk
      // call returned a value for this task, so a failed call never zeroes it.
      const clientWaitMs = clientWaitMap.get(b.clickup_task_id);
      if (clientWaitMs != null) patch.client_wait_ms = clientWaitMs;
      const { error } = await supabase.from("briefs").update(patch).eq("id", b.id);
      if (!error) briefStatusUpdates++;
    }

    const { data: schedTasks } = await supabase
      .from("placement_tasks")
      .select("id, clickup_task_id")
      .not("clickup_task_id", "is", null)
      .order("clickup_status_synced_at", { ascending: true, nullsFirst: true })
      .limit(60);
    for (const t of (schedTasks ?? []) as Array<{ id: string; clickup_task_id: string }>) {
      const status = statusOf(await fetchTask(t.clickup_task_id));
      if (status === null) continue;
      const { error } = await supabase
        .from("placement_tasks")
        .update({ clickup_status: status, clickup_status_synced_at: new Date().toISOString() })
        .eq("id", t.id);
      if (!error) briefStatusUpdates++;
    }

    return json({ inserted, ongoing_inserted: ongoingInserted, brief_status_updates: briefStatusUpdates });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
