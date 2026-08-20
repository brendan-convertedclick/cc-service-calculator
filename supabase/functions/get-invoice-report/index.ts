// supabase/functions/get-invoice-report/index.ts
//
// Invoice report for the Reports page. One client + one billing cycle
// (20th → 20th, end exclusive) in, two buckets out:
//
//   adhoc    — completed, un-invoiced adhoc quick-task briefs. Completion
//              state comes live from ClickUp (status + date_closed); the
//              billable amount comes from the brief's new_billable scope
//              placements when they exist.
//   projects — un-invoiced fixed projects with at least one task first
//              seen closed before the period end (from project_task_rollup).
//              Each project is its own report section.
//
// Un-invoiced work completed BEFORE the period start is still included,
// flagged carried_over=true, so nothing silently slips between cycles.
//
// Request:  POST { client_id, period_start, period_end } (ISO dates, end exclusive)
// Response: { adhoc: {...}, projects: [...], warnings: string[] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";

type Body = { client_id: string; period_start: string; period_end: string };

const CLOSED = new Set(["closed", "complete", "done"]);

type AdhocItem = {
  brief_id: string;
  clickup_task_id: string;
  name: string;
  clickup_task_url: string | null;
  completed_at: string; // ISO
  hours: number;
  amount_cents: number | null;
  carried_over: boolean;
};

type ProjectTask = {
  name: string;
  hours: number;
  closed_at: string; // ISO
  carried_over: boolean;
};

type ProjectReport = {
  project_id: string;
  name: string;
  quote_total_cents: number | null;
  completed_at: string | null;
  status: string;
  tasks: ProjectTask[];
  hours_total: number;
  open_task_count: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id, period_start, period_end } = (await req.json()) as Body;
    if (!client_id || !period_start || !period_end) {
      return json({ error: "client_id, period_start, period_end required" }, 400);
    }
    const startMs = Date.parse(period_start);
    const endMs = Date.parse(period_end);

    const supabase = createServiceRoleClient();
    const warnings: string[] = [];

    // ── Ad hoc: un-invoiced adhoc briefs pushed to ClickUp ─────────────────
    // Briefs attached to a project bill through that project's report, so
    // they're excluded here (and deduped again by task id further down).
    const { data: briefs, error: briefsErr } = await supabase
      .from("briefs")
      .select("id, raw_subject, clickup_task_id, clickup_task_url, clickup_task_status, completed_at, actual_hours, clickup_status_synced_at")
      .eq("client_id", client_id)
      .eq("billing_type", "adhoc")
      .is("invoiced_at", null)
      .is("parent_project_id", null)
      .not("clickup_task_id", "is", null);
    if (briefsErr) return json({ error: briefsErr.message }, 500);

    const { token } = await getOperatorClickupToken(req);
    if (!token && (briefs ?? []).length > 0) {
      warnings.push("No ClickUp token available — adhoc task completion could not be checked.");
    }

    type CuTask = {
      name?: string;
      url?: string;
      status?: { status?: string };
      date_closed?: string | null;
      time_spent?: number;
    };

    const adhocItems: AdhocItem[] = [];
    let adhocOpen = 0;

    // sync-clickup-actuals already mirrors status, close date and time spent
    // onto every briefed task every 30 minutes. Re-fetching all of it live meant
    // one ClickUp call per brief, which on a busy client tripped the rate limit
    // and filled the report with "could not be fetched (429)" instead of lines.
    //
    // So: read what we already hold, and only call ClickUp for rows the sync has
    // never touched.
    type BriefRow = {
      id: string;
      raw_subject: string | null;
      clickup_task_id: string | null;
      clickup_task_url: string | null;
      clickup_task_status: string | null;
      completed_at: string | null;
      actual_hours: number | null;
      clickup_status_synced_at: string | null;
    };

    const all = (briefs ?? []) as unknown as BriefRow[];

    for (const b of all.filter((r) => r.clickup_status_synced_at != null)) {
      const status = (b.clickup_task_status ?? "").toLowerCase();
      if (!CLOSED.has(status)) {
        adhocOpen++;
        continue;
      }
      const completedMs = b.completed_at ? Date.parse(b.completed_at) : Date.now();
      if (completedMs >= endMs) continue; // completed after this cycle
      adhocItems.push({
        brief_id: b.id,
        clickup_task_id: b.clickup_task_id!,
        name: b.raw_subject ?? "(untitled task)",
        clickup_task_url: b.clickup_task_url,
        completed_at: new Date(completedMs).toISOString(),
        hours: Number(b.actual_hours ?? 0),
        amount_cents: null,
        carried_over: completedMs < startMs,
      });
    }

    // Whatever the sync has not reached yet, fetched live — a much smaller set.
    const queue = all.filter((r) => r.clickup_status_synced_at == null);
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      for (;;) {
        const b = queue.shift();
        if (!b) return;
        try {
          let res: Response | null = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            res = await fetch(
              `https://api.clickup.com/api/v2/task/${b.clickup_task_id}`,
              { headers: { Authorization: token } },
            );
            if (res.status !== 429) break;
            // ClickUp says when to come back; default to a widening pause.
            const retryAfter = Number(res.headers.get("retry-after") ?? 0);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
            await new Promise((r) => setTimeout(r, waitMs));
          }
          if (!res || !res.ok) {
            warnings.push(
              res?.status === 429
                ? `ClickUp is rate-limiting us — "${b.raw_subject ?? b.id}" was skipped. Re-run in a minute.`
                : `ClickUp task for "${b.raw_subject ?? b.id}" could not be fetched (${res?.status ?? "no response"}).`,
            );
            continue;
          }
          const task = (await res.json()) as CuTask;
          const status = task.status?.status?.toLowerCase() ?? "";
          if (!CLOSED.has(status)) {
            adhocOpen++;
            continue;
          }
          const closedMs = task.date_closed ? parseInt(task.date_closed) : NaN;
          if (!Number.isFinite(closedMs)) {
            warnings.push(`"${task.name ?? b.raw_subject}" is closed but has no close date — included using today.`);
          }
          const completedMs = Number.isFinite(closedMs) ? closedMs : Date.now();
          if (completedMs >= endMs) continue; // completed after this cycle
          adhocItems.push({
            brief_id: b.id,
            clickup_task_id: b.clickup_task_id!,
            name: task.name ?? b.raw_subject ?? "(untitled task)",
            clickup_task_url: task.url ?? b.clickup_task_url,
            completed_at: new Date(completedMs).toISOString(),
            hours: task.time_spent ? Math.round((task.time_spent / 3_600_000) * 100) / 100 : 0,
            amount_cents: null, // filled from placements below
            carried_over: completedMs < startMs,
          });
        } catch (e) {
          warnings.push(`ClickUp fetch failed for "${b.raw_subject ?? b.id}": ${e instanceof Error ? e.message : e}`);
        }
      }
    });
    await Promise.all(workers);

    // Billable amounts from the brief's scope receipt (new_billable lines).
    if (adhocItems.length > 0) {
      const ids = adhocItems.map((i) => i.brief_id);
      const { data: placements } = await supabase
        .from("brief_task_sow_placements")
        .select("brief_id, disposition, quantity, estimated_cents, suggested_service_id")
        .in("brief_id", ids)
        .eq("disposition", "new_billable");

      const svcIds = [...new Set((placements ?? []).map((p) => p.suggested_service_id).filter(Boolean))];
      const { data: svcs } = svcIds.length
        ? await supabase.from("services").select("id, sell_price_cents").in("id", svcIds as string[])
        : { data: [] as Array<{ id: string; sell_price_cents: number | null }> };
      const svcPrice = new Map((svcs ?? []).map((s) => [s.id, s.sell_price_cents ?? 0]));

      const totals = new Map<string, number>();
      for (const p of placements ?? []) {
        const unit = p.estimated_cents ?? svcPrice.get(p.suggested_service_id as string) ?? 0;
        const qty = Number(p.quantity ?? 1);
        totals.set(p.brief_id, (totals.get(p.brief_id) ?? 0) + Math.round(qty * unit));
      }
      for (const item of adhocItems) {
        const t = totals.get(item.brief_id);
        if (t !== undefined) item.amount_cents = t;
      }
    }
    adhocItems.sort((a, b) => a.completed_at.localeCompare(b.completed_at));

    // ── Projects: un-invoiced fixed projects with tasks closed in period ───
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, name, status, completed_at, quote_id")
      .eq("client_id", client_id)
      .eq("engagement_type", "fixed")
      .is("invoiced_at", null);
    if (projErr) return json({ error: projErr.message }, 500);

    const projectReports: ProjectReport[] = [];
    if ((projects ?? []).length > 0) {
      const projIds = (projects ?? []).map((p) => p.id);
      const { data: rollup, error: rollErr } = await supabase
        .from("project_task_rollup")
        .select("project_id, clickup_task_id, task_name, actual_hours, status_at_sync, closed_at")
        .in("project_id", projIds);
      if (rollErr) return json({ error: rollErr.message }, 500);

      // Dedupe: an adhoc brief whose ClickUp task lives inside a project's
      // rollup would otherwise be billed twice.
      const projectTaskIds = new Set((rollup ?? []).map((r) => r.clickup_task_id));
      for (let i = adhocItems.length - 1; i >= 0; i--) {
        if (projectTaskIds.has(adhocItems[i].clickup_task_id)) adhocItems.splice(i, 1);
      }

      const quoteIds = (projects ?? []).map((p) => p.quote_id).filter(Boolean);
      const { data: quotes } = quoteIds.length
        ? await supabase.from("quotes").select("id, total_cents").in("id", quoteIds as string[])
        : { data: [] as Array<{ id: string; total_cents: number | null }> };
      const quoteTotal = new Map((quotes ?? []).map((q) => [q.id, q.total_cents]));

      for (const p of projects ?? []) {
        const rows = (rollup ?? []).filter((r) => r.project_id === p.id);
        const tasks: ProjectTask[] = [];
        let openCount = 0;
        for (const r of rows) {
          const closedMs = r.closed_at ? Date.parse(r.closed_at) : NaN;
          const isClosed = CLOSED.has((r.status_at_sync ?? "").toLowerCase()) && Number.isFinite(closedMs);
          if (!isClosed) {
            openCount++;
            continue;
          }
          if (closedMs >= endMs) continue;
          tasks.push({
            name: r.task_name ?? "(unnamed task)",
            hours: Math.round(Number(r.actual_hours ?? 0) * 100) / 100,
            closed_at: new Date(closedMs).toISOString(),
            carried_over: closedMs < startMs,
          });
        }
        if (tasks.length === 0) continue;
        tasks.sort((a, b) => a.closed_at.localeCompare(b.closed_at));
        projectReports.push({
          project_id: p.id,
          name: p.name ?? "(unnamed project)",
          quote_total_cents: p.quote_id ? (quoteTotal.get(p.quote_id) ?? null) : null,
          completed_at: p.completed_at,
          status: p.status,
          tasks,
          hours_total: Math.round(tasks.reduce((s, t) => s + t.hours, 0) * 100) / 100,
          open_task_count: openCount,
        });
      }
    }

    return json({
      client_id,
      period_start,
      period_end,
      adhoc: { items: adhocItems, open_count: adhocOpen },
      projects: projectReports,
      warnings,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
