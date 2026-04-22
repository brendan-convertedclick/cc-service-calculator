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
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled || !settings.clickup_pat) {
      return new Response(JSON.stringify({ skipped: "clickup disabled" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const CU = {
      headers: {
        Authorization: settings.clickup_pat!,
        "Content-Type": "application/json",
      },
    };

    const { data: projects } = await supabase
      .from("projects").select("*").eq("status", "in_progress");

    let inserted = 0;
    for (const p of projects ?? []) {
      // Latest snapshot per task from the view. supabase-js doesn't know
      // about the view in its generated types, but at runtime it's just a
      // relation and .from() accepts the name. Cast to satisfy TS.
      const { data: current } = await supabase
        // deno-lint-ignore no-explicit-any
        .from("project_actuals_current" as any)
        .select("*")
        .eq("project_id", p.id);

      const actuals = (current ?? []) as Array<{
        clickup_task_id: string;
        dept_id: string | null;
        planned_hours: number;
        project_id: string;
      }>;

      let allDone = actuals.length > 0;

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
          allDone = false;
          continue;
        }
        const task = await tRes.json();

        const timeEntries = teRes.ok ? (await teRes.json()).data : null;
        const actualHours = (timeEntries ?? []).reduce(
          (acc: number, e: { duration?: string }) =>
            acc + Number(e.duration ?? 0) / 3_600_000,
          0,
        );

        const status: string | null = task.status?.status?.toLowerCase() ?? null;
        if (status !== "complete" && status !== "closed" && status !== "done") allDone = false;

        // Append-only insert: a brand new row per task per tick. recorded_at
        // defaults to now() via the column default added in migration 0013.
        const { error: insErr } = await supabase
          .from("project_actuals")
          .insert({
            project_id: a.project_id,
            clickup_task_id: a.clickup_task_id,
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

      if (allDone) {
        await supabase
          .from("projects")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", p.id);
      }
    }

    return new Response(JSON.stringify({ inserted }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
