// supabase/functions/provision-ongoing-tasks/index.ts
//
// Two request shapes:
//
//   Legacy (Team page, single member, overhead-only):
//     POST { team_member_id: string }
//
//   Matrix (Planner page, four-axis fan-out):
//     POST {
//       member_ids:        string[],
//       client_ids:        string[],     // empty = overhead-only flow
//       task_template_ids: string[],     // templates must all belong to group_id
//       group_id?:         string,       // required when client_ids non-empty
//     }
//
// Response: 200 {
//   provisioned: number,
//   skipped:     number,
//   created:     Array<{ member_id, client_id|null, task_template_id, clickup_task_id }>,
//   failed:      Array<{ member_id, client_id|null, task_template_id, reason }>
// }
//
// Row-by-row commit so a mid-batch failure leaves at most one orphan
// ClickUp task. Partial-success is reported in `failed[]` instead of
// failing the whole call — the planner UI surfaces it per cell.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

export function buildTaskName(
  member: { full_name: string },
  category: { label: string; label_key: string },
  client?: { short_name?: string | null; name?: string } | null,
): string {
  if (client) {
    const short = client.short_name ?? client.name ?? "Client";
    return `[Ongoing] ${member.full_name} — ${short} — ${category.label}`;
  }
  return `[Internal] ${member.full_name} — ${category.label}`;
}

type ReqLegacy = { team_member_id: string };
type ReqMatrix = {
  member_ids: string[];
  client_ids: string[];
  task_template_ids: string[];
  group_id?: string | null;
};
type Req = Partial<ReqLegacy & ReqMatrix>;

type Created = {
  member_id: string;
  client_id: string | null;
  task_template_id: string;
  clickup_task_id: string;
};
type Failed = {
  member_id: string;
  client_id: string | null;
  task_template_id: string;
  reason: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json() as Req;

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    const { data: settings } = await supabase
      .from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled" }, 400);

    // Normalise legacy shape into matrix shape.
    let memberIds: string[];
    let clientIds: string[];
    let templateIds: string[] | null;
    let groupId: string | null;

    if (body.team_member_id && !body.member_ids) {
      memberIds = [body.team_member_id];
      clientIds = [];
      templateIds = null; // all active overhead templates
      groupId = null;
    } else {
      memberIds = body.member_ids ?? [];
      clientIds = body.client_ids ?? [];
      templateIds = body.task_template_ids ?? null;
      groupId = body.group_id ?? null;
      if (memberIds.length === 0) return json({ error: "member_ids required" }, 400);
      if (clientIds.length > 0 && !groupId) {
        return json({ error: "group_id required when client_ids non-empty" }, 400);
      }
    }

    // Pull members, clients, templates in one round-trip each.
    const { data: members } = await supabase
      .from("team_members")
      .select("id, full_name, clickup_user_id, archived_at")
      .in("id", memberIds);
    if (!members || members.length === 0) return json({ error: "no valid members" }, 400);
    const activeMembers = members.filter((m) => !m.archived_at);
    if (activeMembers.length === 0) return json({ error: "all members archived" }, 400);

    const clientsById = new Map<
      string,
      { id: string; name: string; short_name: string }
    >();
    if (clientIds.length > 0) {
      const { data: clients } = await supabase
        .from("clients")
        .select("id, name, short_name, archived_at")
        .in("id", clientIds);
      for (const c of clients ?? []) {
        if (!c.archived_at) {
          clientsById.set(c.id, {
            id: c.id,
            name: c.name,
            short_name: c.short_name,
          });
        }
      }
      if (clientsById.size === 0) return json({ error: "no valid clients" }, 400);
    }

    let templateQuery = supabase
      .from("time_categories")
      .select("id, label, label_key, group_id, is_custom, client_id, archived_at")
      .is("archived_at", null);
    if (templateIds && templateIds.length > 0) {
      templateQuery = templateQuery.in("id", templateIds);
    }
    const { data: templates } = await templateQuery;
    if (!templates || templates.length === 0) {
      return json({ error: "no valid templates" }, 400);
    }

    // For client-scoped runs, every template must belong to group_id.
    if (clientIds.length > 0 && groupId) {
      const bad = (templates as Array<{ group_id: string | null }>)
        .find((t) => t.group_id !== groupId);
      if (bad) {
        return json(
          { error: "all task_template_ids must belong to group_id" },
          400,
        );
      }
    }

    // Resolve client → client_lists row (by group_id) up front.
    const clientListByClient = new Map<string, { id: string; clickup_list_id: string }>();
    if (clientIds.length > 0 && groupId) {
      const { data: cls } = await supabase
        .from("client_lists")
        .select("id, client_id, clickup_list_id, custom_label")
        .in("client_id", Array.from(clientsById.keys()))
        .eq("group_id", groupId)
        .is("archived_at", null)
        .is("custom_label", null);
      for (const r of cls ?? []) {
        clientListByClient.set(r.client_id, {
          id: r.id,
          clickup_list_id: r.clickup_list_id,
        });
      }
    }

    // Existing ongoing_tasks rows so we skip already-provisioned cells.
    const { data: existing } = await supabase
      .from("ongoing_tasks")
      .select("team_member_id, client_id, time_category_id")
      .in("team_member_id", activeMembers.map((m) => m.id))
      .is("archived_at", null);
    const existingKeys = new Set(
      (existing ?? []).map(
        (r) => `${r.team_member_id}|${r.client_id ?? ""}|${r.time_category_id}`,
      ),
    );

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    let provisioned = 0;
    let skipped = 0;
    const created: Created[] = [];
    const failed: Failed[] = [];

    // Build the cell list (clientIds=[] → single null-client iteration).
    const clientCells: Array<{ id: string; row: { id: string; name: string; short_name: string } | null }> =
      clientIds.length > 0
        ? Array.from(clientsById.values()).map((c) => ({ id: c.id, row: c }))
        : [{ id: "__overhead__", row: null }];

    for (const member of activeMembers) {
      for (const cell of clientCells) {
        const isOverhead = cell.row === null;
        const clientIdKey = isOverhead ? "" : cell.id;
        const clientForKey = isOverhead ? null : cell.id;

        // Resolve target list once per cell.
        let listId: string | null;
        let clientListId: string | null;
        if (isOverhead) {
          listId = settings.clickup_internal_list_id ?? null;
          clientListId = null;
          if (!listId) {
            for (const tmpl of templates) {
              failed.push({
                member_id: member.id,
                client_id: null,
                task_template_id: tmpl.id,
                reason: "settings.clickup_internal_list_id not set",
              });
            }
            continue;
          }
        } else {
          const mapped = clientListByClient.get(cell.id);
          if (!mapped) {
            for (const tmpl of templates) {
              failed.push({
                member_id: member.id,
                client_id: cell.id,
                task_template_id: tmpl.id,
                reason: `no client_lists row for group on ${cell.row?.short_name ?? cell.id} — map a list first`,
              });
            }
            continue;
          }
          listId = mapped.clickup_list_id;
          clientListId = mapped.id;
        }

        for (const tmpl of templates) {
          const key = `${member.id}|${clientIdKey}|${tmpl.id}`;
          if (existingKeys.has(key)) {
            skipped++;
            continue;
          }

          // Refuse custom templates against the wrong client.
          if (tmpl.is_custom && tmpl.client_id !== clientForKey) {
            failed.push({
              member_id: member.id,
              client_id: clientForKey,
              task_template_id: tmpl.id,
              reason: "custom template not scoped to this client",
            });
            continue;
          }

          const name = buildTaskName(member, tmpl, cell.row);
          const cuRes = await fetch(
            `https://api.clickup.com/api/v2/list/${listId}/task`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                name,
                description: isOverhead
                  ? `Ongoing time bucket for ${member.full_name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`
                  : `Ongoing time bucket for ${member.full_name} on ${cell.row?.name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`,
                assignees: member.clickup_user_id ? [member.clickup_user_id] : [],
                status: "in progress",
              }),
            },
          );
          if (!cuRes.ok) {
            failed.push({
              member_id: member.id,
              client_id: clientForKey,
              task_template_id: tmpl.id,
              reason: `CU task create failed: ${await cuRes.text()}`,
            });
            continue;
          }
          const cuTask = await cuRes.json() as { id?: string };
          if (!cuTask?.id) {
            failed.push({
              member_id: member.id,
              client_id: clientForKey,
              task_template_id: tmpl.id,
              reason: "CU returned no task id",
            });
            continue;
          }

          const { error: insErr } = await supabase.from("ongoing_tasks").insert({
            team_member_id: member.id,
            time_category_id: tmpl.id,
            client_id: clientForKey,
            client_list_id: clientListId,
            clickup_task_id: cuTask.id,
            task_name: name,
          });
          if (insErr) {
            failed.push({
              member_id: member.id,
              client_id: clientForKey,
              task_template_id: tmpl.id,
              reason: insErr.message,
            });
            continue;
          }

          provisioned++;
          created.push({
            member_id: member.id,
            client_id: clientForKey,
            task_template_id: tmpl.id,
            clickup_task_id: cuTask.id,
          });
        }
      }
    }

    return json({ provisioned, skipped, created, failed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
