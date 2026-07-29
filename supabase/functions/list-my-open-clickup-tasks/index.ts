// supabase/functions/list-my-open-clickup-tasks/index.ts
//
// Request:  POST { client_id?: string }
// Response: 200 { tasks: [{ id, name, list_name, sprint_points, due_date }] }
//
// Returns the open ClickUp tasks assigned to the calling user. Used by the
// Phase 2 extension request form's "Task" dropdown. If client_id is given,
// results are filtered to that client's folder lists.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";

type CuTask = {
  id: string;
  name: string;
  list?: { id: string; name: string };
  status?: { type?: string; status?: string };
  points?: number | null;
  due_date?: string | null;
  custom_fields?: Array<{ name: string; value?: unknown }>;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { client_id } = (await req.json()) as { client_id?: string };
    const supabase = createUserClient(req);
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings")
      .select("clickup_workspace_id")
      .eq("id", 1)
      .single();
    if (!settings?.clickup_workspace_id) {
      return json({ error: "clickup_workspace_id missing" }, 400);
    }

    const userEmail = (await supabase.auth.getUser()).data.user?.email ?? "";
    const { data: me } = await supabase
      .from("team_members")
      .select("clickup_user_id")
      .eq("email", userEmail)
      .maybeSingle();
    const cuUserId = (me as { clickup_user_id: number | null } | null)?.clickup_user_id;
    if (!cuUserId) {
      return json({ error: "Your team_members row has no clickup_user_id" }, 400);
    }

    // Optionally scope by client folder lists.
    let listIds: string[] = [];
    if (client_id) {
      const { data: client } = await supabase
        .from("clients")
        .select("clickup_folder_id")
        .eq("id", client_id)
        .single();
      const folderId = (client as { clickup_folder_id: string | null } | null)?.clickup_folder_id;
      if (!folderId) {
        return json({ error: "Client not linked to a ClickUp folder" }, 400);
      }
      const listsRes = await fetch(
        `https://api.clickup.com/api/v2/folder/${folderId}/list`,
        { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
      );
      if (!listsRes.ok) {
        return json({ error: `ClickUp lists ${listsRes.status}: ${await listsRes.text()}` }, 502);
      }
      const listsBody = (await listsRes.json()) as { lists?: Array<{ id: string }> };
      listIds = (listsBody.lists ?? []).map((l) => l.id);
    }

    // Workspace-scoped task filter: assignee=me, not closed.
    const params = new URLSearchParams();
    params.set("assignees[]", String(cuUserId));
    params.set("subtasks", "false");
    params.set("include_closed", "false");
    params.set("page", "0");
    for (const id of listIds) params.append("list_ids[]", id);

    const tasksRes = await fetch(
      `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/task?${params.toString()}`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!tasksRes.ok) {
      return json({ error: `ClickUp tasks ${tasksRes.status}: ${await tasksRes.text()}` }, 502);
    }
    const body = (await tasksRes.json()) as { tasks?: CuTask[] };
    const tasks = (body.tasks ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      list_name: t.list?.name ?? "",
      sprint_points: extractSprintPoints(t.points, t.custom_fields),
      due_date: t.due_date ? Number(t.due_date) : null,
    }));

    return json({ tasks });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Sprint points are set as ClickUp's NATIVE `points` field on create (see
// _shared/clickup.ts) — a list-specific "Sprint Points" custom field is only
// a fallback for lists that don't have the native Sprints ClickApp enabled.
function extractSprintPoints(
  nativePoints: number | null | undefined,
  fields?: Array<{ name: string; value?: unknown }>,
): number | null {
  if (typeof nativePoints === "number" && Number.isFinite(nativePoints)) return nativePoints;
  if (!fields) return null;
  const f = fields.find((x) => x.name.trim().toLowerCase() === "sprint points");
  if (!f || f.value === undefined || f.value === null) return null;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : null;
}
