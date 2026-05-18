// supabase/functions/list-client-clickup-lists/index.ts
//
// Request:  POST { client_id: string }
// Response: 200 { lists: [{ id: string, name: string }] }
//
// Returns the ClickUp lists inside a client's folder. Used by the Phase 1
// staff brief form's "List / department" dropdown.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

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

    const res = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!res.ok) return json({ error: `ClickUp ${res.status}: ${await res.text()}` }, 502);

    const body = (await res.json()) as { lists?: Array<{ id: string; name: string }> };
    const lists = (body.lists ?? [])
      .map((l) => ({ id: l.id, name: l.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return json({ lists });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
