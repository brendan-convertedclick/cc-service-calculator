// supabase/functions/clickup-reconcile/index.ts
//
// "Is everything in ClickUp actually in Conductor?"
//
// Lisa, 2026-09-02: a confidence value showing that everything from ClickUp has
// been ingested correctly, and a comparative report to check Conductor against.
// This is that reconciliation, done the way it was done by hand on 2026-09-02:
// every task in the Clients space that has closed since a date, matched one by
// one against every table that can legitimately own a ClickUp task.
//
// FIVE ownership checks, and all five are needed. Meetings were 40 of 536 tasks
// on the first run and retainer parents another 2 — without those two joins the
// report invents 42 problems that are not problems, and a report that cries
// wolf is worse than no report.
//
// The score is deliberately computed on CLIENT work only. Internal admin —
// stand-ups, Monday status, the Ops list — is created straight in ClickUp and
// was never meant to be a brief, so counting it would peg confidence at ~65%
// for ever and the number would stop meaning anything.
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { cuFetch } from "../_shared/clickup.ts";

interface CuTask {
  id: string;
  name: string;
  points: number | null;
  list: { id: string; name: string } | null;
  date_closed: string | null;
}

/** ClickUp pages at 100; `last_page` is the only honest end-of-list signal. */
async function fetchClosedTasks(
  pat: string,
  teamId: string,
  spaceId: string,
  sinceMs: number,
): Promise<{ tasks: CuTask[]; pages: number; truncated: boolean }> {
  const out: CuTask[] = [];
  const MAX_PAGES = 40; // 4,000 tasks — a wall, not a limit we expect to meet
  let page = 0;
  for (; page < MAX_PAGES; page++) {
    const url =
      `https://api.clickup.com/api/v2/team/${teamId}/task` +
      `?page=${page}&include_closed=true&subtasks=true` +
      `&space_ids[]=${spaceId}&date_done_gt=${sinceMs}`;
    const res = await cuFetch(url, { headers: { Authorization: pat } });
    if (!res.ok) {
      throw new Error(`ClickUp ${res.status} on page ${page}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = await res.json() as { tasks?: CuTask[]; last_page?: boolean };
    out.push(...(body.tasks ?? []));
    if (body.last_page || (body.tasks ?? []).length === 0) return { tasks: out, pages: page + 1, truncated: false };
  }
  return { tasks: out, pages: page, truncated: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  try {
    const body = await req.json().catch(() => ({})) as { since?: string };
    // Default: the start of last month, which is the window anyone asking this
    // question cares about — this month plus the one being reported on.
    const now = new Date();
    const defaultSince = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const since = body.since ? new Date(`${body.since}T00:00:00Z`) : defaultSince;
    if (Number.isNaN(since.getTime())) return json({ error: "since must be YYYY-MM-DD" }, 400);

    const pat = Deno.env.get("CLICKUP_PAT") ?? "";
    if (!pat) return json({ error: "CLICKUP_PAT is not set" }, 500);

    const sb = createServiceRoleClient();
    const { data: settings } = await sb
      .from("settings")
      .select("clickup_workspace_id, clickup_clients_space_id")
      .maybeSingle();
    const teamId = settings?.clickup_workspace_id;
    const spaceId = settings?.clickup_clients_space_id;
    if (!teamId || !spaceId) {
      return json({ error: "Set the ClickUp workspace and Clients space on the Settings page first" }, 400);
    }

    const { tasks, pages, truncated } = await fetchClosedTasks(pat, teamId, spaceId, since.getTime());

    // ── Everything that may legitimately own a ClickUp task ──────────────────
    const [briefsRes, provRes, ongoingRes, meetRes, parentRes, listsRes] = await Promise.all([
      sb.from("briefs").select("clickup_task_id").not("clickup_task_id", "is", null),
      sb.from("provisioned_tasks").select("clickup_task_ids"),
      sb.from("ongoing_tasks").select("clickup_task_id"),
      sb.from("internal_meeting_tasks").select("clickup_task_id"),
      sb.from("projects").select("clickup_parent_task_id").not("clickup_parent_task_id", "is", null),
      sb.from("client_lists").select("clickup_list_id, clients(name, is_internal)"),
    ]);

    const known = new Set<string>();
    const add = (v: unknown) => { if (typeof v === "string" && v) known.add(v); };
    for (const r of briefsRes.data ?? []) add((r as { clickup_task_id: string }).clickup_task_id);
    for (const r of provRes.data ?? []) for (const id of (r as { clickup_task_ids: string[] | null }).clickup_task_ids ?? []) add(id);
    for (const r of ongoingRes.data ?? []) add((r as { clickup_task_id: string }).clickup_task_id);
    for (const r of meetRes.data ?? []) add((r as { clickup_task_id: string }).clickup_task_id);
    for (const r of parentRes.data ?? []) add((r as { clickup_parent_task_id: string }).clickup_parent_task_id);

    // A list belongs to a client, and a client is ours or a paying one. An
    // unmapped list is its own finding — Trellidor's Adhoc Work list was one.
    type ListRow = { clickup_list_id: string; clients: { name: string; is_internal: boolean } | null };
    const listClient = new Map<string, { name: string; internal: boolean }>();
    for (const r of (listsRes.data ?? []) as unknown as ListRow[]) {
      if (r.clients) listClient.set(r.clickup_list_id, { name: r.clients.name, internal: r.clients.is_internal });
    }

    const missing: Array<{ task_id: string; name: string; list: string; client: string | null; points: number | null }> = [];
    let clientTasks = 0;
    let clientMatched = 0;
    let internalUnmatched = 0;
    const unmappedLists = new Map<string, string>();

    for (const t of tasks) {
      const listId = t.list?.id ?? "";
      const owner = listClient.get(listId);
      if (!owner) unmappedLists.set(listId, t.list?.name ?? "(unnamed)");
      const isClientWork = owner ? !owner.internal : true; // unmapped counts as client work: better to over-report
      if (isClientWork) clientTasks++;
      if (known.has(t.id)) {
        if (isClientWork) clientMatched++;
        continue;
      }
      if (!isClientWork) { internalUnmatched++; continue; }
      missing.push({
        task_id: t.id,
        name: t.name,
        list: t.list?.name ?? "",
        client: owner?.name ?? null,
        points: t.points ?? null,
      });
    }

    // ── What Conductor can see wrong about itself ───────────────────────────
    const staleCut = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [staleRes, briefedNoTaskRes, lastSyncRes, archivedRes] = await Promise.all([
      sb.from("briefs").select("id", { count: "exact", head: true })
        .not("clickup_task_id", "is", null).neq("status", "archived").lt("clickup_status_synced_at", staleCut),
      sb.from("briefs").select("id, raw_subject, created_at, clients(name)")
        .in("status", ["briefed", "accepted"]).is("clickup_task_id", null),
      sb.from("briefs").select("clickup_status_synced_at")
        .not("clickup_status_synced_at", "is", null)
        .order("clickup_status_synced_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("briefs").select("id", { count: "exact", head: true }).eq("status", "archived"),
    ]);

    const missingPoints = missing.reduce((n, m) => n + (m.points ?? 0), 0);
    // One number, and it only ever measures client work — see the header.
    const confidence = clientTasks === 0 ? 100 : Math.round((clientMatched / clientTasks) * 1000) / 10;

    return json({
      window: { since: since.toISOString().slice(0, 10), pages, truncated },
      clickup: {
        closed_tasks: tasks.length,
        client_tasks: clientTasks,
        client_matched: clientMatched,
        internal_unmatched: internalUnmatched,
      },
      confidence,
      missing: missing.sort((a, b) => (b.points ?? 0) - (a.points ?? 0)),
      missing_points: missingPoints,
      missing_hours: missingPoints * 0.25,
      unmapped_lists: [...unmappedLists.entries()].map(([id, name]) => ({ list_id: id, name })),
      conductor: {
        last_sync: lastSyncRes.data?.clickup_status_synced_at ?? null,
        stale_briefs: staleRes.count ?? 0,
        archived_briefs: archivedRes.count ?? 0,
        briefed_without_task: (briefedNoTaskRes.data ?? []).map((b: unknown) => {
          const r = b as unknown as { id: string; raw_subject: string | null; created_at: string; clients: { name: string } | null };
          return { id: r.id, subject: r.raw_subject, created_at: r.created_at, client: r.clients?.name ?? null };
        }),
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
