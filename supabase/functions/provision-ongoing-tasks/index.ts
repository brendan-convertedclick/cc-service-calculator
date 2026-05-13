// supabase/functions/provision-ongoing-tasks/index.ts
//
// Request:  POST { team_member_id: string }
// Response: 200 { provisioned: number, skipped: number, created: [...] }
//
// For every active time_category, ensure there's an ongoing_tasks row
// for this team member. If missing, create a ClickUp task in the
// configured internal list, then insert the row.
//
// Idempotent: re-runs do nothing if everything is already provisioned.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

export function buildTaskName(
  member: { full_name: string },
  category: { label: string; label_key: string },
): string {
  return `[Internal] ${member.full_name} — ${category.label}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { team_member_id } = await req.json() as { team_member_id?: string };
    if (!team_member_id) return json({ error: "team_member_id required" }, 400);

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");

    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled" }, 400);
    if (!settings.clickup_internal_list_id) {
      return json({ error: "clickup_internal_list_id not set in settings" }, 400);
    }
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const { data: member, error: mErr } = await supabase
      .from("team_members")
      .select("id, full_name, clickup_user_id, archived_at")
      .eq("id", team_member_id).single();
    if (mErr || !member) return json({ error: mErr?.message ?? "Member not found" }, 404);
    if (member.archived_at) return json({ error: "Member is archived" }, 400);

    const { data: categories } = await supabase
      .from("time_categories")
      .select("*")
      .is("archived_at", null)
      .order("display_order");

    const { data: existing } = await supabase
      .from("ongoing_tasks")
      .select("time_category_id")
      .eq("team_member_id", team_member_id)
      .is("archived_at", null);
    const existingByCat = new Set((existing ?? []).map((r) => r.time_category_id));

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };
    const listId = settings.clickup_internal_list_id;

    let provisioned = 0;
    let skipped = 0;
    const created: Array<{ category: string; clickup_task_id: string }> = [];
    const toInsert: Array<{
      team_member_id: string;
      time_category_id: string;
      clickup_task_id: string;
      task_name: string;
    }> = [];

    for (const cat of (categories ?? [])) {
      if (existingByCat.has(cat.id)) { skipped++; continue; }

      const name = buildTaskName(member, cat);
      const cuRes = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          name,
          description:
            `Ongoing time bucket for ${member.full_name}.\n` +
            `Category: ${cat.label}. Rize posts time entries here.\n` +
            `Do not close — this task is perpetual.`,
          assignees: member.clickup_user_id ? [member.clickup_user_id] : [],
          status: "in progress",
        }),
      });
      if (!cuRes.ok) {
        return json({ error: `CU task create failed: ${await cuRes.text()}` }, 502);
      }
      const cuTask = await cuRes.json();
      if (!cuTask?.id) {
        return json(
          { error: `CU task create returned no id: ${JSON.stringify(cuTask)}` },
          502,
        );
      }

      toInsert.push({
        team_member_id: member.id,
        time_category_id: cat.id,
        clickup_task_id: cuTask.id,
        task_name: name,
      });
      provisioned++;
      created.push({ category: cat.label, clickup_task_id: cuTask.id });
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("ongoing_tasks").insert(toInsert);
      if (insErr) return json({ error: insErr.message }, 500);
    }

    return json({ provisioned, skipped, created });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
