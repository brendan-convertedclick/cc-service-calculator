// supabase/functions/sync-clickup-actuals/index.ts
//
// Invoked on a schedule (pg_cron → net.http_post, see migration 0011).
//
// For every in_progress project:
//   - Fetch each child ClickUp task's status
//   - Fetch each child ClickUp task's time entries, sum duration → hours
//   - Upsert project_actuals by (project_id, clickup_task_id)
//   - If every child's status resolves to complete/closed/done, mark the
//     project completed_at=now(), status='completed'
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

    let updated = 0;
    for (const p of projects ?? []) {
      const { data: actuals } = await supabase
        .from("project_actuals").select("*").eq("project_id", p.id);
      let allDone = (actuals ?? []).length > 0;

      for (const a of actuals ?? []) {
        const tRes = await fetch(
          `https://api.clickup.com/api/v2/task/${a.clickup_task_id}?include_subtasks=false`,
          CU,
        );
        if (!tRes.ok) {
          allDone = false;
          continue;
        }
        const task = await tRes.json();

        const teRes = await fetch(
          `https://api.clickup.com/api/v2/task/${a.clickup_task_id}/time`,
          CU,
        );
        const timeEntries = teRes.ok ? (await teRes.json()).data : null;
        const actualHours = (timeEntries ?? []).reduce(
          (acc: number, e: { duration?: string }) =>
            acc + Number(e.duration ?? 0) / 3_600_000,
          0,
        );

        const status: string | null = task.status?.status?.toLowerCase() ?? null;
        if (status !== "complete" && status !== "closed" && status !== "done") allDone = false;

        await supabase
          .from("project_actuals")
          .update({
            actual_hours: actualHours,
            time_entries: timeEntries,
            status_at_sync: status,
            synced_at: new Date().toISOString(),
          })
          .eq("id", a.id);
        updated++;
      }

      if (allDone) {
        await supabase
          .from("projects")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", p.id);
      }
    }

    return new Response(JSON.stringify({ updated }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
