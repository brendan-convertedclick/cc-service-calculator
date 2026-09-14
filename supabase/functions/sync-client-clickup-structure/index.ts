// supabase/functions/sync-client-clickup-structure/index.ts
//
// Request:  POST { client_id: string }
// Response: 200 {
//   discovered: number,      // new client_lists rows inserted this run
//   refreshed: number,       // existing rows whose CU name we updated
//   archived: number,        // rows whose CU list is no longer live
//   lists: Array<{ id, clickup_list_id, clickup_list_name, group_id|null }>
// }
//
// Reads the client's ClickUp Folder, lists every CU List inside, and stages
// staging rows in `client_lists` (with group_id NULL until the user maps
// them). Idempotent: re-runs refresh names, add lists that have appeared on
// the CU side, and archive rows whose list is gone from it.
//
// The archive sweep is the load-bearing half. ClickUp is asked for
// `?archived=false`, so a List archived over there simply stops appearing;
// without the sweep its `client_lists` row stays live forever and every
// consumer keeps routing into a list nobody can see. That is how The Media
// Mixology's Administration, Meetings and Overhead groups spent months
// pointing at archived lists, and why re-running Foundations reported four
// lists already mapped and created nothing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type CuList = { id: string; name: string; archived?: boolean };
type CuListResponse = { lists?: CuList[] };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id } = await req.json() as { client_id?: string };
    if (!client_id) return json({ error: "client_id required" }, 400);

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, name, clickup_folder_id, archived_at")
      .eq("id", client_id)
      .single();
    if (cErr || !client) return json({ error: cErr?.message ?? "Client not found" }, 404);
    if (client.archived_at) return json({ error: "Client is archived" }, 400);
    if (!client.clickup_folder_id) {
      return json(
        { error: `Client ${client.name} has no clickup_folder_id` },
        400,
      );
    }

    // Pull every CU list inside the client's folder. The endpoint doesn't
    // paginate via offset; archived_at filter is passed as a query param.
    const cuRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list?archived=false`,
      { headers: { Authorization: clickupPat } },
    );
    if (!cuRes.ok) {
      return json({ error: `CU folder/list fetch failed: ${await cuRes.text()}` }, 502);
    }
    const cuBody = await cuRes.json() as CuListResponse;
    const cuLists = cuBody.lists ?? [];

    // Load existing rows for this client so we can diff.
    const { data: existing } = await supabase
      .from("client_lists")
      .select("id, clickup_list_id, clickup_list_name, group_id")
      .eq("client_id", client_id)
      .is("archived_at", null);
    const existingByCu = new Map(
      (existing ?? []).map((r) => [r.clickup_list_id, r] as const),
    );

    let discovered = 0;
    let refreshed = 0;
    const now = new Date().toISOString();

    for (const cu of cuLists) {
      const hit = existingByCu.get(cu.id);
      if (hit) {
        if (hit.clickup_list_name !== cu.name) {
          const { error } = await supabase
            .from("client_lists")
            .update({ clickup_list_name: cu.name })
            .eq("id", hit.id);
          if (error) return json({ error: error.message }, 500);
          refreshed++;
        }
        continue;
      }

      const { error } = await supabase.from("client_lists").insert({
        client_id,
        group_id: null,
        clickup_list_id: cu.id,
        clickup_list_name: cu.name,
        discovered_at: now,
      });
      if (error) return json({ error: error.message }, 500);
      discovered++;
    }

    // Archive rows whose list has left the folder (archived or deleted in CU).
    // Archiving is the whole fix: every partial unique index on this table and
    // every consumer that routes work filters on `archived_at is null`, so the
    // group slot frees up and Foundations will create a real list next run.
    //
    // Guarded on a non-empty CU response. A 200 with no lists is far more
    // likely to be a ClickUp hiccup than a client whose folder was emptied,
    // and this sweep is the one destructive step in the function.
    let archived = 0;
    const liveCuIds = new Set(cuLists.map((l) => l.id));
    const stale = (existing ?? []).filter((r) => !liveCuIds.has(r.clickup_list_id));
    if (cuLists.length > 0 && stale.length > 0) {
      const { error } = await supabase
        .from("client_lists")
        .update({ archived_at: now })
        .in("id", stale.map((r) => r.id));
      if (error) return json({ error: error.message }, 500);
      archived = stale.length;
    }

    // Return the full current picture so the UI can render the mapping
    // screen straight from the response.
    const { data: lists } = await supabase
      .from("client_lists")
      .select("id, clickup_list_id, clickup_list_name, group_id, custom_label")
      .eq("client_id", client_id)
      .is("archived_at", null)
      .order("clickup_list_name");

    return json({ discovered, refreshed, archived, lists: lists ?? [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
