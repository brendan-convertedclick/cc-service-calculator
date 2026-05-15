// supabase/functions/apply-foundations/index.ts
//
// Apply the Foundations baseline (Lists + optional seed Tasks) to one or
// more clients. Idempotent — re-runs only create what's missing.
//
// Request:
//   POST {
//     client_ids:         string[],            // required, >= 1
//     baseline_list_ids?: string[] | null,     // omit = all active baselines
//     include_tasks?:     boolean,             // default true
//   }
//
// Response: 200 {
//   applied: Array<{
//     client_id: string,
//     lists_created: number,
//     lists_existing: number,
//     tasks_created: number,
//     tasks_existing: number,
//   }>,
//   skipped: Array<{ client_id: string, reason: string }>,
//   errors:  Array<{ client_id: string, baseline_list_id?: string, baseline_task_id?: string, reason: string }>
// }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";

type CuList = { id: string; name: string };
type CuTask = { id?: string };

type Applied = {
  client_id: string;
  lists_created: number;
  lists_existing: number;
  tasks_created: number;
  tasks_existing: number;
};
type Skipped = { client_id: string; reason: string };
type ErrItem = {
  client_id: string;
  baseline_list_id?: string;
  baseline_task_id?: string;
  reason: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json() as {
      client_ids?: string[];
      baseline_list_ids?: string[] | null;
      include_tasks?: boolean;
    };
    if (!body.client_ids || body.client_ids.length === 0) {
      return json({ error: "client_ids required" }, 400);
    }
    const includeTasks = body.include_tasks ?? true;

    const supabase = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT not set" }, 500);

    // Load baseline lists (optionally filtered).
    let blQuery = supabase
      .from("baseline_lists")
      .select("id, group_id, label, display_order, archived_at")
      .is("archived_at", null)
      .order("display_order");
    if (body.baseline_list_ids && body.baseline_list_ids.length > 0) {
      blQuery = blQuery.in("id", body.baseline_list_ids);
    }
    const { data: baselines, error: blErr } = await blQuery;
    if (blErr) return json({ error: blErr.message }, 500);
    if (!baselines || baselines.length === 0) {
      return json({ error: "no active baseline_lists matched" }, 400);
    }

    // Pre-load baseline_tasks per baseline_list.
    const baselineIds = baselines.map((b) => b.id);
    const { data: bTasks } = await supabase
      .from("baseline_tasks")
      .select("id, baseline_list_id, name, description, display_order, archived_at")
      .in("baseline_list_id", baselineIds)
      .is("archived_at", null)
      .order("display_order");
    const tasksByList = new Map<string, typeof bTasks>();
    for (const t of bTasks ?? []) {
      const arr = tasksByList.get(t.baseline_list_id) ?? [];
      arr.push(t);
      tasksByList.set(t.baseline_list_id, arr);
    }

    // Pull clients.
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, clickup_folder_id, archived_at")
      .in("id", body.client_ids);

    const applied: Applied[] = [];
    const skipped: Skipped[] = [];
    const errors: ErrItem[] = [];
    const CU = {
      headers: { Authorization: clickupPat, "Content-Type": "application/json" },
    };

    for (const clientId of body.client_ids) {
      const client = clients?.find((c) => c.id === clientId);
      if (!client) {
        skipped.push({ client_id: clientId, reason: "client not found" });
        continue;
      }
      if (client.archived_at) {
        skipped.push({ client_id: clientId, reason: "client archived" });
        continue;
      }
      if (!client.clickup_folder_id) {
        skipped.push({ client_id: clientId, reason: "no clickup_folder_id" });
        continue;
      }

      // Resolve existing client_lists per group for this client.
      const { data: existingLists } = await supabase
        .from("client_lists")
        .select("id, group_id, clickup_list_id")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .is("custom_label", null);
      const listByGroup = new Map<string, { id: string; clickup_list_id: string }>();
      for (const r of existingLists ?? []) {
        if (r.group_id) {
          listByGroup.set(r.group_id, {
            id: r.id,
            clickup_list_id: r.clickup_list_id,
          });
        }
      }

      // Existing task log for this client.
      const { data: log } = await supabase
        .from("client_baseline_tasks_log")
        .select("baseline_task_id")
        .eq("client_id", clientId);
      const loggedTasks = new Set<string>(
        (log ?? []).map((r) => r.baseline_task_id),
      );

      const stat: Applied = {
        client_id: clientId,
        lists_created: 0,
        lists_existing: 0,
        tasks_created: 0,
        tasks_existing: 0,
      };

      for (const baseline of baselines) {
        // 1) Ensure list
        let mapped = listByGroup.get(baseline.group_id);
        if (mapped) {
          stat.lists_existing++;
        } else {
          const cuRes = await fetch(
            `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({ name: baseline.label }),
            },
          );
          if (!cuRes.ok) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              reason: `CU list create failed: ${await cuRes.text()}`,
            });
            continue;
          }
          const cuList = await cuRes.json() as CuList;
          if (!cuList?.id) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              reason: "CU returned no list id",
            });
            continue;
          }
          const { data: inserted, error: insErr } = await supabase
            .from("client_lists")
            .insert({
              client_id: clientId,
              group_id: baseline.group_id,
              clickup_list_id: cuList.id,
              clickup_list_name: cuList.name,
              custom_label: null,
            })
            .select("id, clickup_list_id")
            .single();
          if (insErr || !inserted) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              reason: insErr?.message ?? "client_lists insert failed",
            });
            continue;
          }
          mapped = { id: inserted.id, clickup_list_id: inserted.clickup_list_id };
          listByGroup.set(baseline.group_id, mapped);
          stat.lists_created++;
        }

        // 2) Optionally seed tasks
        if (!includeTasks) continue;
        const seedTasks = tasksByList.get(baseline.id) ?? [];
        for (const t of seedTasks) {
          if (loggedTasks.has(t.id)) {
            stat.tasks_existing++;
            continue;
          }
          const cuTaskRes = await fetch(
            `https://api.clickup.com/api/v2/list/${mapped.clickup_list_id}/task`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                name: t.name,
                description: t.description ?? "",
                status: "to do",
              }),
            },
          );
          if (!cuTaskRes.ok) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              baseline_task_id: t.id,
              reason: `CU task create failed: ${await cuTaskRes.text()}`,
            });
            continue;
          }
          const cuTask = await cuTaskRes.json() as CuTask;
          if (!cuTask?.id) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              baseline_task_id: t.id,
              reason: "CU returned no task id",
            });
            continue;
          }
          const { error: logErr } = await supabase
            .from("client_baseline_tasks_log")
            .insert({
              client_id: clientId,
              baseline_task_id: t.id,
              clickup_task_id: cuTask.id,
            });
          if (logErr) {
            errors.push({
              client_id: clientId,
              baseline_list_id: baseline.id,
              baseline_task_id: t.id,
              reason: `log insert failed: ${logErr.message}`,
            });
            continue;
          }
          loggedTasks.add(t.id);
          stat.tasks_created++;
        }
      }

      applied.push(stat);
    }

    return json({ applied, skipped, errors });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
