// supabase/functions/create-client-list/index.ts
//
// Request:  POST {
//   client_id:     string,
//   group_id?:     string,   // null = create as a custom_label list
//   custom_label?: string,   // required if group_id is null
// }
// Response: 200 { client_list_id, clickup_list_id, clickup_list_name }
//
// Creates a new ClickUp List inside the client's Folder and inserts a
// `client_lists` row pointing at it. Used by the "+ New list" affordance
// on the per-client mapping screen and the matrix planner page.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type CuList = { id: string; name: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json() as {
      client_id?: string;
      group_id?: string | null;
      custom_label?: string | null;
    };
    if (!body.client_id) return json({ error: "client_id required" }, 400);
    if (!body.group_id && !body.custom_label) {
      return json({ error: "group_id or custom_label required" }, 400);
    }
    if (body.group_id && body.custom_label) {
      return json(
        { error: "Pass either group_id or custom_label, not both" },
        400,
      );
    }

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, name, clickup_folder_id, archived_at")
      .eq("id", body.client_id)
      .single();
    if (cErr || !client) return json({ error: cErr?.message ?? "Client not found" }, 404);
    if (client.archived_at) return json({ error: "Client is archived" }, 400);
    if (!client.clickup_folder_id) {
      return json(
        { error: `Client ${client.name} has no clickup_folder_id` },
        400,
      );
    }

    // Resolve the list name. For group-mapped lists, use the group label;
    // for custom lists, use the caller's custom_label verbatim.
    let listName: string;
    if (body.group_id) {
      const { data: group, error: gErr } = await supabase
        .from("task_groups")
        .select("label, archived_at")
        .eq("id", body.group_id)
        .single();
      if (gErr || !group) return json({ error: "task_group not found" }, 404);
      if (group.archived_at) return json({ error: "task_group is archived" }, 400);

      // Refuse to create a duplicate group mapping for the same client.
      const { count } = await supabase
        .from("client_lists")
        .select("id", { count: "exact", head: true })
        .eq("client_id", body.client_id)
        .eq("group_id", body.group_id)
        .is("archived_at", null)
        .is("custom_label", null);
      if ((count ?? 0) > 0) {
        return json(
          { error: `Client already has a list mapped to ${group.label}` },
          409,
        );
      }
      listName = group.label;
    } else {
      listName = body.custom_label!.trim();
      if (!listName) return json({ error: "custom_label cannot be empty" }, 400);
    }

    const cuRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      {
        method: "POST",
        headers: {
          Authorization: clickupPat,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: listName }),
      },
    );
    if (!cuRes.ok) {
      return json({ error: `CU list create failed: ${await cuRes.text()}` }, 502);
    }
    const cuList = await cuRes.json() as CuList;
    if (!cuList?.id) {
      return json(
        { error: `CU list create returned no id: ${JSON.stringify(cuList)}` },
        502,
      );
    }

    const { data: row, error: insErr } = await supabase
      .from("client_lists")
      .insert({
        client_id: body.client_id,
        group_id: body.group_id ?? null,
        clickup_list_id: cuList.id,
        clickup_list_name: cuList.name,
        custom_label: body.custom_label ?? null,
      })
      .select("id, clickup_list_id, clickup_list_name")
      .single();
    if (insErr || !row) {
      return json(
        {
          error: insErr?.message ?? "Insert failed",
          orphan_clickup_list_id: cuList.id,
        },
        500,
      );
    }

    return json({
      client_list_id: row.id,
      clickup_list_id: row.clickup_list_id,
      clickup_list_name: row.clickup_list_name,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
