// supabase/functions/provision-ongoing-tasks/index.ts
//
// Two request shapes:
//
//   Legacy (Team page, single member, overhead-only):
//     POST { team_member_id: string }
//
//   Matrix (Planner page): one task per client × category, with every
//   member assigned to it. No clients = the per-person overhead flow.
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
import { cuFetch } from "../_shared/clickup.ts";

export function buildTaskName(
  member: { full_name: string },
  category: { label: string; label_key: string },
  client?: { short_name?: string | null; name?: string } | null,
): string {
  // A client task sits in that client's list and is shared by everyone on
  // it, so neither the client nor a person belongs in the title (Lisa's
  // 2026-09-17 naming rule).
  if (client) return `[Ongoing] ${category.label}`;
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
      .select("id, label, label_key, group_id, is_custom, client_id, billable, archived_at")
      .is("archived_at", null);
    if (templateIds && templateIds.length > 0) {
      templateQuery = templateQuery.in("id", templateIds);
    } else if (groupId) {
      // "Every category in this group" is what a client-scoped run with no
      // explicit list means. Without this it loaded EVERY group's categories
      // and then failed its own must-belong-to-group check, so the whole-group
      // shorthand was unusable — TEST New School's Administration, Delivery and
      // Meetings tasks had to be provisioned by naming all six ids by hand.
      templateQuery = templateQuery.eq("group_id", groupId);
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

    // Existing ongoing_tasks rows so we skip already-provisioned cells. A
    // client task is shared, so it is keyed on client × category with no
    // member in it; filtering by member here would hide a task Lisa made from
    // Brendan's run and mint a second one. Overhead stays per person.
    const { data: existing } = await supabase
      .from("ongoing_tasks")
      .select("team_member_id, client_id, time_category_id")
      .is("archived_at", null)
      .eq("adopted", false);
    const existingKeys = new Set(
      (existing ?? []).map((r) =>
        r.client_id
          ? `${r.client_id}|${r.time_category_id}`
          : `${r.team_member_id}||${r.time_category_id}`
      ),
    );

    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    let provisioned = 0;
    let skipped = 0;
    const created: Created[] = [];
    const failed: Failed[] = [];

    type Cell = {
      key: string;
      owner: (typeof activeMembers)[number];
      assignees: typeof activeMembers;
      client: { id: string; name: string; short_name: string } | null;
      listId: string;
      clientListId: string | null;
      tmpl: (typeof templates)[number];
    };
    const cells: Cell[] = [];
    const failAll = (clientId: string | null, reason: string, members = activeMembers) => {
      for (const m of members) {
        for (const tmpl of templates) {
          failed.push({ member_id: m.id, client_id: clientId, task_template_id: tmpl.id, reason });
        }
      }
    };

    if (clientIds.length > 0) {
      // One task per client × category, everyone picked assigned to it. The
      // first person picked owns the row (team_member_id is NOT NULL); time is
      // attributed per logger from the entries, as for a shared adopted task.
      const owner = activeMembers[0];
      for (const client of clientsById.values()) {
        const mapped = clientListByClient.get(client.id);
        if (!mapped) {
          failAll(client.id, `no client_lists row for group on ${client.short_name ?? client.id} — map a list first`, [owner]);
          continue;
        }
        for (const tmpl of templates) {
          cells.push({
            key: `${client.id}|${tmpl.id}`,
            owner,
            assignees: activeMembers,
            client,
            listId: mapped.clickup_list_id,
            clientListId: mapped.id,
            tmpl,
          });
        }
      }
    } else {
      const listId = settings.clickup_internal_list_id ?? null;
      if (!listId) {
        failAll(null, "settings.clickup_internal_list_id not set");
      } else {
        for (const member of activeMembers) {
          for (const tmpl of templates) {
            cells.push({
              key: `${member.id}||${tmpl.id}`,
              owner: member,
              assignees: [member],
              client: null,
              listId,
              clientListId: null,
              tmpl,
            });
          }
        }
      }
    }

    for (const { key, owner, assignees, client, listId, clientListId, tmpl } of cells) {
      const clientId = client?.id ?? null;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      // Refuse custom templates against the wrong client.
      if (tmpl.is_custom && tmpl.client_id !== clientId) {
        failed.push({
          member_id: owner.id,
          client_id: clientId,
          task_template_id: tmpl.id,
          reason: "custom template not scoped to this client",
        });
        continue;
      }

      const name = buildTaskName(owner, tmpl, client);
      // Resolve effective billable: ongoing_tasks override is null at create
      // time, so the template default rules.
      const billable = !!tmpl.billable;
      const cuRes = await cuFetch(
        `https://api.clickup.com/api/v2/list/${listId}/task`,
        {
          ...CU,
          method: "POST",
          body: JSON.stringify({
            name,
            description: client
              ? `Ongoing time bucket for ${client.name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`
              : `Ongoing time bucket for ${owner.full_name}. Category: ${tmpl.label}. Rize posts time entries here. Do not close — this task is perpetual.`,
            assignees: assignees
              .map((m) => m.clickup_user_id)
              .filter((id): id is number => id != null),
            // Omit `status` — let ClickUp use the list's default. Client
            // spaces use custom status sets, so hardcoding a status name
            // fails with CRTSK_001 "Status not found". (Rize matches time
            // entries by task id, not status, so this is safe.)
            billable,
          }),
        },
      );
      if (!cuRes.ok) {
        failed.push({
          member_id: owner.id,
          client_id: clientId,
          task_template_id: tmpl.id,
          reason: `CU task create failed: ${await cuRes.text()}`,
        });
        continue;
      }
      const cuTask = await cuRes.json() as { id?: string };
      if (!cuTask?.id) {
        failed.push({
          member_id: owner.id,
          client_id: clientId,
          task_template_id: tmpl.id,
          reason: "CU returned no task id",
        });
        continue;
      }

      const { error: insErr } = await supabase.from("ongoing_tasks").insert({
        team_member_id: owner.id,
        time_category_id: tmpl.id,
        client_id: clientId,
        client_list_id: clientListId,
        clickup_task_id: cuTask.id,
        task_name: name,
        billable,
      });
      if (insErr) {
        failed.push({
          member_id: owner.id,
          client_id: clientId,
          task_template_id: tmpl.id,
          reason: insErr.message,
        });
        continue;
      }

      existingKeys.add(key);
      provisioned++;
      created.push({
        member_id: owner.id,
        client_id: clientId,
        task_template_id: tmpl.id,
        clickup_task_id: cuTask.id,
      });
    }

    return json({ provisioned, skipped, created, failed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
