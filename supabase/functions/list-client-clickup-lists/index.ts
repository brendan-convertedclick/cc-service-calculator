// supabase/functions/list-client-clickup-lists/index.ts
//
// Request:  POST { client_id: string }
// Response: 200 {
//   lists: [{ id: string, name: string, work_stream: string | null, statuses: Array<{ status: string, color: string | null, type: string, orderindex: number }> }],
//   work_stream_options: Array<{ id: string, name: string }>
// }
//
// Returns the ClickUp lists inside a client's folder. Used by every "List"
// dropdown in the app (staff brief, quick brief, meeting, new project, the
// schedule stage).
//
// `work_stream` is resolved HERE rather than in the browser (Lisa, 2026-09-21).
// The aliases already exist and `resolveListAlias` already reads them for the
// edge functions that create tasks; resolving once on the way out means all
// five dropdowns group identically and none of them needs its own copy of the
// rule, or RLS on list_aliases. It is additive: the id and name are untouched,
// so a caller that ignores it behaves exactly as before. Nothing is filtered —
// a list with no stream is still a real ClickUp list somebody may need.
//
// ClickUp client lists INHERIT their statuses from the parent Space (each
// status's `status_group` is the space, e.g. `proj_55422995`), so the
// folder/list response's per-list `statuses` array comes back empty. The
// effective (inherited) statuses only show up on the single-list endpoint
// (`GET /list/{list_id}`), so we fetch that per list, in parallel.
//
// The "Work Stream" custom field's dropdown options are shared across the
// folder's lists, so we fetch it once from the first list.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { cuFetch, resolveListAlias, type AliasRow, type OverrideRow } from "../_shared/clickup.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id } = (await req.json()) as { client_id?: string };
    if (!client_id) return json({ error: "client_id required" }, 400);

    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: client, error } = await supabase
      .from("clients")
      .select("id, name, clickup_folder_id")
      .eq("id", client_id)
      .single();
    if (error || !client) return json({ error: error?.message ?? "Client not found" }, 404);
    if (!client.clickup_folder_id) {
      return json({
        error: `${client.name} is not linked to a ClickUp folder. Link it on the Clients page first.`,
      }, 400);
    }

    const clickupHeaders = { Authorization: clickupPat, "Content-Type": "application/json" };

    const res = await cuFetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      { headers: clickupHeaders },
    );
    if (!res.ok) {
      const detail = await res.text();
      return json({
        error: res.status === 429
          ? "ClickUp is rate-limiting us right now — wait a few seconds and reopen this."
          : `ClickUp ${res.status}: ${detail}`,
      }, 502);
    }

    const body = (await res.json()) as {
      lists?: Array<{ id: string; name: string }>;
    };
    const bareLists = (body.lists ?? []).map((l) => ({ id: l.id, name: l.name }));

    type ClickUpStatus = { status: string; color?: string | null; type: string; orderindex: number };

    // Effective statuses (including space-inherited ones) only come back from
    // the single-list endpoint. Fetch them in parallel; a single list's
    // failure shouldn't fail the whole request — default it to [].
    const fetchStatuses = async (l: { id: string; name: string }) => {
      try {
        const listRes = await cuFetch(`https://api.clickup.com/api/v2/list/${l.id}`, {
          headers: clickupHeaders,
        });
        if (!listRes.ok) return { ...l, statuses: [] as ClickUpStatus[] };
        const listBody = (await listRes.json()) as { statuses?: ClickUpStatus[] };
        return { ...l, statuses: listBody.statuses ?? [] };
      } catch {
        return { ...l, statuses: [] as ClickUpStatus[] };
      }
    };
    // Four at a time, not all at once. A busy client folder holds a dozen or
    // more lists, and firing every one in parallel is what put this over
    // ClickUp's limit and returned a bare 502 to the brief sheet.
    const listsWithStatuses: Array<{ id: string; name: string; statuses: ClickUpStatus[] }> = [];
    for (let i = 0; i < bareLists.length; i += 4) {
      listsWithStatuses.push(...await Promise.all(bareLists.slice(i, i + 4).map(fetchStatuses)));
    }

    // resolveListAlias answers "which list is this work stream", so it is run
    // once per stream and the answer inverted into list name -> stream. That
    // keeps one definition of the mapping rather than a second one that reads
    // the arrays directly and drifts from it.
    const [aliasRes, overrideRes] = await Promise.all([
      supabase.from("list_aliases").select("work_stream, aliases"),
      supabase.from("list_alias_overrides").select("client_id, work_stream, list_name"),
    ]);
    const aliasRows = (aliasRes.data ?? []) as AliasRow[];
    const overrideRows = (overrideRes.data ?? []) as OverrideRow[];
    const streamOfList = new Map<string, string>();
    for (const row of aliasRows) {
      const resolved = resolveListAlias(row.work_stream, aliasRows, overrideRows, client_id);
      // The override names the ONE list that wins for this client; without one
      // every alias of the stream maps to it.
      const names = resolved?.source === "override"
        ? [resolved.list_name]
        : (row.aliases ?? []);
      for (const n of names) streamOfList.set(n.trim().toLowerCase(), row.work_stream);
    }

    const lists = listsWithStatuses
      .map((l) => ({
        id: l.id,
        name: l.name,
        work_stream: streamOfList.get(l.name.trim().toLowerCase()) ?? null,
        statuses: (l.statuses ?? []).map((s) => ({
          status: s.status,
          color: s.color ?? null,
          type: s.type,
          orderindex: Number(s.orderindex),
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Work Stream custom-field options are shared across the folder's lists —
    // fetch once, from the first list. The client silently falls back to
    // Conductor's department names when this comes back empty, and those
    // names don't reliably match the real ClickUp option set (exact-match
    // resolver, see resolveDropdownOption) — so a single transient ClickUp
    // API hiccup here can leave a task's Work Stream field blank. One retry
    // covers that without adding real latency on the (normal) success path.
    let workStreamOptions: Array<{ id: string; name: string }> = [];
    if (bareLists.length > 0) {
      for (let attempt = 0; attempt < 2 && workStreamOptions.length === 0; attempt++) {
        try {
          const fieldRes = await cuFetch(
            `https://api.clickup.com/api/v2/list/${bareLists[0].id}/field`,
            { headers: clickupHeaders },
          );
          if (fieldRes.ok) {
            const fieldBody = (await fieldRes.json()) as {
              fields?: Array<{
                name: string;
                type: string;
                type_config?: { options?: Array<{ id: string; name: string }> };
              }>;
            };
            const workStreamField = (fieldBody.fields ?? []).find(
              (f) => f.type === "drop_down" && f.name.toLowerCase() === "work stream",
            );
            workStreamOptions = (workStreamField?.type_config?.options ?? []).map((o) => ({
              id: o.id,
              name: o.name,
            }));
          }
        } catch {
          // fall through to retry / leave empty
        }
      }
    }

    return json({ lists, work_stream_options: workStreamOptions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
