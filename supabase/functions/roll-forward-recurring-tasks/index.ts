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
// Each invocation is idempotent — re-running the same month is a no-op, which
// is what makes back-filling safe: POST { period_start: "2026-08-01" } to
// provision a month the cron dropped. A back-fill deliberately skips the
// due-date update, so it cannot drag live retainers into a past month.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

// How many retainers to provision at once. Each one makes a string of
// SEQUENTIAL ClickUp calls inside provision-retainer-period, so the real
// request rate is roughly this many in flight — firing all 33 at once put the
// shared token over ClickUp's limit and the tail of the queue silently got
// nothing back. July 2026 lost 18 retainers that way, August 7, and the only
// symptom was somebody asking months later why a task never appeared.
const CONCURRENCY = 4;
// One retry, because the failure being defended against is a rate limit and the
// second attempt lands after the earlier batch has drained.
const ATTEMPTS = 2;

/** Runs `work` over `items` with at most `limit` in flight, preserving order. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST/GET only" }, 405);

  // An explicit period back-fills a month the cron missed. Absent — the normal
  // monthly run — it is today's month.
  let requestedPeriod: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const v = (body as { period_start?: unknown })?.period_start;
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) requestedPeriod = v;
    } catch {
      // no body, or not JSON — the normal cron shape
    }
  }

  const sb = createServiceRoleClient();

  const { data: retainers, error } = await sb
    .from("projects")
    .select("id")
    .or("is_recurring.eq.true,engagement_type.eq.retainer")
    .neq("status", "archived");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  const periodStart = requestedPeriod ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  // Retainers carry the current period's month-end due date. This runs BEFORE
  // the provisioning fan-out below: it depends only on today's date, and going
  // last meant a fan-out that overran the function's wall clock killed the
  // process before the update ever fired — every retainer kept last period's
  // due date and the dashboard filed them all as overdue (Jul and Aug 2026).
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString();
  // ...but only on the real monthly run. Back-filling a month the cron missed
  // must not drag every live retainer's due date back into it.
  const { error: dueErr } = requestedPeriod
    ? { error: null }
    : await sb
      .from("projects")
      .update({ due_date: periodEnd })
      .eq("engagement_type", "retainer")
      .neq("status", "archived");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  // A BOUNDED pool, not Promise.all. The unbounded version was written to avoid
  // the wall-clock limit of doing 30+ retainers sequentially, and it traded one
  // silent failure for another: every retainer's ClickUp calls in flight at once
  // put the shared token over the rate limit, and whichever projects lost that
  // race got nothing, with res.ok true and a body that reported no error.
  const results = await pooled(retainers ?? [], CONCURRENCY, async (p) => {
    let last: unknown = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/provision-retainer-period`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: anon },
          body: JSON.stringify({ project_id: p.id, period_start: periodStart }),
        });
        const body = await res.json();
        if (res.ok) return { project_id: p.id, ok: true, attempt, detail: body };
        last = body;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    return { project_id: p.id, ok: false, attempt: ATTEMPTS, detail: last };
  });

  // Surfaced rather than buried in `results`: a partial month is the failure
  // this function has actually had three times, and it has always looked like
  // success from the outside.
  const failed = results.filter((r) => !r.ok);
  return json({
    period_start: periodStart,
    backfill: requestedPeriod != null,
    count: retainers?.length ?? 0,
    failed_count: failed.length,
    failed,
    results,
    retainer_due_date: requestedPeriod ? null : periodEnd,
    ...(dueErr ? { due_date_error: dueErr.message } : {}),
  });
});
