// supabase/functions/roll-forward-recurring-tasks/index.ts
//
// Cron entry (migration 0063). Runs on the 1st of every month (00:05 UTC)
// and invokes provision-retainer-period for every active recurring project
// (is_recurring = true OR engagement_type = 'retainer'; status != archived).
// Retainers are created with is_recurring = true (since migration 0062); the
// engagement_type clause keeps them rolling even if the flag is unchecked.
//
// Also advances due_date to the current month-end for all active retainers,
// so on-time tracking always measures against the running period.
//
// Each invocation is idempotent — re-running the same month is a no-op.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST/GET only" }, 405);

  const sb = createServiceRoleClient();

  const { data: retainers, error } = await sb
    .from("projects")
    .select("id")
    .or("is_recurring.eq.true,engagement_type.eq.retainer")
    .neq("status", "archived");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  // Retainers carry the current period's month-end due date. This runs BEFORE
  // the provisioning fan-out below: it depends only on today's date, and going
  // last meant a fan-out that overran the function's wall clock killed the
  // process before the update ever fired — every retainer kept last period's
  // due date and the dashboard filed them all as overdue (Jul and Aug 2026).
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString();
  const { error: dueErr } = await sb
    .from("projects")
    .update({ due_date: periodEnd })
    .eq("engagement_type", "retainer")
    .neq("status", "archived");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  // Run every project's provisioning concurrently — sequential awaits across
  // 30+ retainers (each several ClickUp round trips) risked the whole batch
  // running past the edge function's wall-clock limit, silently starving
  // whichever projects the DB happened to return last (no error, no log —
  // just missing provisioned_tasks rows for that month).
  const results = await Promise.all(
    (retainers ?? []).map(async (p) => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/provision-retainer-period`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: anon },
          body: JSON.stringify({ project_id: p.id, period_start: periodStart }),
        });
        const body = await res.json();
        return { project_id: p.id, ok: res.ok, detail: body };
      } catch (e) {
        return { project_id: p.id, ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  return json({
    period_start: periodStart,
    count: retainers?.length ?? 0,
    results,
    retainer_due_date: periodEnd,
    ...(dueErr ? { due_date_error: dueErr.message } : {}),
  });
});
