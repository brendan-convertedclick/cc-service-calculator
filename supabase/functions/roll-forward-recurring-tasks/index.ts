// supabase/functions/roll-forward-recurring-tasks/index.ts
//
// Cron entry. Runs on the 1st of every month (00:05 Africa/Johannesburg)
// and invokes provision-retainer-period for every active retainer project
// (is_recurring = true, status != archived).
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
    .eq("is_recurring", true)
    .neq("status", "archived");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const results: Array<{ project_id: string; ok: boolean; detail?: unknown }> = [];

  for (const p of retainers ?? []) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/provision-retainer-period`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: anon },
        body: JSON.stringify({ project_id: p.id, period_start: periodStart }),
      });
      const body = await res.json();
      results.push({ project_id: p.id, ok: res.ok, detail: body });
    } catch (e) {
      results.push({
        project_id: p.id,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return json({ period_start: periodStart, count: retainers?.length ?? 0, results });
});
