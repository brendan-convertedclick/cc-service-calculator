// supabase/functions/push-to-clickup/index.ts
//
// Request:  POST { quote_id: string }
// Response: 200 { project_id, clickup_parent_task_id, child_count }
//
// Preconditions: settings.clickup_enabled=true, settings.clickup_workspace_id
// set, and the CLICKUP_PAT Edge Function secret is configured
// (Deno.env.get('CLICKUP_PAT')).
//
// Flow:
//   1. Load quote + scope + brief + client + line allocations.
//   2. Require client.clickup_folder_id (set via the Clients page). If
//      null, return 400 pointing the user there.
//   3. List the folder's lists (GET /folder/{id}/list). Pick one named
//      /projects/i, or the first.
//   4. Create a parent task named after brief.raw_subject.
//   5. For each line_item × allocation: create a child task with
//      time_estimate = hours * 60 * 60000 ms, optional assignee resolved
//      from team_members, then post a BRIEF:: comment.
//   6. Insert projects row + project_actuals rows (one per child).
//
// Atomicity: we generate the project id client-side and only insert the
// projects row AFTER every ClickUp child task + comment succeeds. If any
// ClickUp call fails we bubble the error and never write to the DB — so
// retries are not blocked by the projects.quote_id unique constraint. If
// the project_actuals bulk insert fails after projects inserted, we run a
// compensating delete on the projects row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { buildBriefComment } from "../_shared/clickup.ts";

type SnapshotAllocation = {
  dept_id: string;
  dept_name: string;
  hours: number;
  cost_share_cents: number;
};
type SnapshotLineItem = {
  service_id: string;
  service_name: string;
  qty: number;
  allocation: SnapshotAllocation[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createUserClient(req);

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();
    if (!settings?.clickup_enabled) return json({ error: "ClickUp disabled in settings" }, 400);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);
    if (!settings.clickup_workspace_id) return json({ error: "clickup_workspace_id missing in settings" }, 400);

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("*, scope:scopes(*, brief:briefs(*, client:clients(*)))")
      .eq("id", quote_id).single();
    if (error || !quote) return json({ error: error?.message ?? "Not found" }, 404);

    const scope = (quote as {
      scope: {
        brief: {
          raw_subject: string | null;
          client_id: string;
          client: { id: string; name: string; clickup_folder_id: string | null } | null;
        } | null;
      };
    }).scope;
    const client = scope.brief?.client;
    if (!client) return json({ error: "Client missing" }, 400);

    const CU = {
      headers: {
        Authorization: clickupPat,
        "Content-Type": "application/json",
      },
    };

    const folderId = client.clickup_folder_id;
    if (!folderId) {
      return json({
        error: "Client not linked to a ClickUp folder — link it on the Clients page.",
      }, 400);
    }

    // Find a list inside the client's folder. Prefer one named /projects/i.
    const listsRes = await fetch(`https://api.clickup.com/api/v2/folder/${folderId}/list`, CU);
    if (!listsRes.ok) return json({ error: `CU lists: ${await listsRes.text()}` }, 502);
    const lists = await listsRes.json();
    const projectsList =
      (lists.lists ?? []).find((l: { name: string }) => /projects/i.test(l.name)) ??
      (lists.lists ?? [])[0];
    if (!projectsList) return json({ error: "No list found in client folder" }, 404);

    // Fetch ClickUp custom field definitions from the target list so we
    // can populate required dropdowns by matching option names at push time.
    type CuField = {
      id: string;
      name: string;
      type: string;
      type_config?: { options?: Array<{ id: string; name: string }> };
    };
    let cuFields: CuField[] = [];
    const fieldsRes = await fetch(
      `https://api.clickup.com/api/v2/list/${projectsList.id}/field`,
      CU,
    );
    if (fieldsRes.ok) {
      cuFields = (await fieldsRes.json()).fields ?? [];
    }

    // Create parent task.
    const parentRes = await fetch(
      `https://api.clickup.com/api/v2/list/${projectsList.id}/task`,
      {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          name: scope.brief?.raw_subject ?? "Untitled project",
          description: `Project from quote ${quote.id}`,
        }),
      },
    );
    if (!parentRes.ok) return json({ error: `CU parent: ${await parentRes.text()}` }, 502);
    const parent = await parentRes.json();

    // Load team_members + list_aliases (for future alias resolution — payload
    // currently just routes by the parent list so the alias table isn't used
    // in Phase 1, but we keep the roster lookup for assignee resolution).
    const { data: team } = await supabase
      .from("team_members")
      .select("id,full_name,email,primary_department_id,clickup_user_id")
      .is("archived_at", null);

    // Generate the project id up front so each actuals row can reference it
    // while we're still in the ClickUp loop. The projects row itself is
    // inserted LAST (after every ClickUp child succeeds) to keep the push
    // atomic — see the file header for the rationale.
    const projectId = crypto.randomUUID();

    // Load the frozen snapshot from the normalized table and re-aggregate
    // into the items × allocation grouping the task-creation loop expects.
    const { data: allocRows, error: allocErr } = await supabase
      .from("quote_line_item_allocations")
      .select("*")
      .eq("quote_id", quote.id)
      .order("ordinal");
    if (allocErr) return json({ error: allocErr.message }, 500);

    const itemsByOrdinal = new Map<number, SnapshotLineItem>();
    for (const r of (allocRows ?? []) as Array<{
      ordinal: number;
      service_id: string;
      service_name: string;
      qty: number | string;
      dept_id: string;
      dept_name: string;
      hours: number | string;
      cost_share_cents: number | string;
    }>) {
      let item = itemsByOrdinal.get(r.ordinal);
      if (!item) {
        item = {
          service_id: r.service_id,
          service_name: r.service_name,
          qty: Number(r.qty),
          allocation: [],
        };
        itemsByOrdinal.set(r.ordinal, item);
      }
      item.allocation.push({
        dept_id: r.dept_id,
        dept_name: r.dept_name,
        hours: Number(r.hours),
        cost_share_cents: Number(r.cost_share_cents),
      });
    }
    const items = Array.from(itemsByOrdinal.values());

    // Fetch default_due_days for each service so child tasks get a due date.
    const serviceIds = [...new Set(items.map((i) => i.service_id))];
    const { data: svcRows } = serviceIds.length > 0
      ? await supabase
          .from("services")
          .select("id,default_due_days")
          .in("id", serviceIds)
      : { data: [] };
    const dueDaysMap = new Map<string, number | null>(
      (svcRows ?? []).map((s: { id: string; default_due_days: number | null }) => [
        s.id,
        s.default_due_days,
      ]),
    );

    // Resolve ClickUp custom field dropdown options by name (case-insensitive).
    function resolveDropdownOption(
      fieldName: string,
      optionName: string,
    ): { id: string; value: string } | null {
      const field = cuFields.find(
        (f) => f.name === fieldName && f.type === "drop_down",
      );
      if (!field?.type_config?.options) return null;
      const needle = optionName.trim().toLowerCase();
      const option = field.type_config.options.find(
        (o) => o.name?.trim().toLowerCase() === needle,
      );
      return option ? { id: field.id, value: option.id } : null;
    }

    // Build custom fields that are the same for every child task in this push.
    const sharedCustomFields: Array<{ id: string; value: string | number }> = [];
    const clientCf = resolveDropdownOption("Client Name", client.name);
    if (clientCf) sharedCustomFields.push(clientCf);
    const engCf = resolveDropdownOption("Engagement Type", "Task");
    if (engCf) sharedCustomFields.push(engCf);
    const dateField = cuFields.find(
      (f) => f.name === "Date of Engagement" && f.type === "date",
    );
    if (dateField) sharedCustomFields.push({ id: dateField.id, value: Date.now() });

    type ActualRow = {
      project_id: string;
      clickup_task_id: string;
      dept_id: string;
      planned_hours: number;
    };
    const actualsRows: ActualRow[] = [];
    let childCount = 0;

    // Flatten (item × allocation) so we can batch across the entire push
    // rather than just within a single line item.
    const tasks = items.flatMap((item) =>
      item.allocation.map((alloc) => ({ item, alloc })),
    );

    // ClickUp's free tier rate-limits us to 100 req/min. Each task = 2 calls
    // (create + comment), so a batch of 5 in parallel = ~10 req/sec peak,
    // leaving comfortable headroom. Using Promise.all (fail-fast, not
    // allSettled) is deliberate: any failure aborts the whole push BEFORE
    // we insert the projects row, preserving atomicity so the user can
    // retry the same quote without hitting the unique constraint.
    const BATCH_SIZE = 5;
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ({ item, alloc }): Promise<ActualRow> => {
          const assignee = (team ?? []).find(
            (t: { primary_department_id: string | null; clickup_user_id: number | null }) =>
              t.primary_department_id === alloc.dept_id && t.clickup_user_id,
          );

          const taskCf = [...sharedCustomFields];
          const wsCf = resolveDropdownOption("Work Stream", alloc.dept_name);
          if (wsCf) taskCf.push(wsCf);

          const dueDays = dueDaysMap.get(item.service_id);
          const now = Date.now();
          const dueDateMs = dueDays
            ? now + dueDays * 24 * 60 * 60 * 1000
            : undefined;

          const childRes = await fetch(
            `https://api.clickup.com/api/v2/list/${projectsList.id}/task`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                name: `${item.service_name} — ${alloc.dept_name}`,
                parent: parent.id,
                assignees: assignee?.clickup_user_id ? [assignee.clickup_user_id] : [],
                time_estimate: Math.round(alloc.hours * 60 * 60_000),
                points: Math.min(10, Math.max(1, Math.round(alloc.hours / 4))),
                ...(dueDateMs !== undefined && {
                  due_date: dueDateMs,
                  due_date_time: false,
                  start_date: now,
                  start_date_time: false,
                }),
                ...(taskCf.length > 0 && { custom_fields: taskCf }),
              }),
            },
          );
          // Fail-fast: previously this did `continue` and silently dropped
          // the child. That left us with a projects row and a partial
          // actuals set, making the quote un-pushable on retry (unique
          // constraint on projects.quote_id). Throwing aborts the batch
          // before any DB writes happen, so retries are clean.
          if (!childRes.ok) {
            throw new Error(
              `CU child task failed (${item.service_name} / ${alloc.dept_name}): ${await childRes.text()}`,
            );
          }
          const child = await childRes.json();

          // BRIEF:: audit comment (matches /brief grammar).
          const commentRes = await fetch(
            `https://api.clickup.com/api/v2/task/${child.id}/comment`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                comment_text: buildBriefComment({
                  client_name: client.name,
                  engagement_type: "Task",
                  work_stream: alloc.dept_name,
                  sprint_points: Math.max(1, Math.round(alloc.hours / 4)),
                  date_of_engagement: new Date().toISOString().slice(0, 10),
                  source_quote_id: quote.id,
                }),
              }),
            },
          );
          if (!commentRes.ok) {
            throw new Error(
              `CU comment failed (task ${child.id}): ${await commentRes.text()}`,
            );
          }

          return {
            project_id: projectId,
            clickup_task_id: child.id,
            dept_id: alloc.dept_id,
            planned_hours: alloc.hours,
          };
        }),
      );
      actualsRows.push(...results);
      childCount += results.length;
    }

    // All ClickUp work succeeded — safe to write the projects row now.
    const { error: pErr } = await supabase
      .from("projects")
      .insert({
        id: projectId,
        quote_id: quote.id,
        clickup_parent_task_id: parent.id,
        name: scope.brief?.raw_subject ?? "Untitled project",
        status: "in_progress",
      });
    if (pErr) return json({ error: pErr.message }, 500);

    if (actualsRows.length > 0) {
      const { error: aErr } = await supabase
        .from("project_actuals")
        .insert(actualsRows);
      if (aErr) {
        // Compensating delete: the projects row exists but actuals are
        // missing. Roll back so a retry isn't blocked by the unique
        // constraint on quote_id. If the rollback itself fails, surface
        // both errors — otherwise the caller would see only aErr and not
        // realise the projects row is still present (blocking retries).
        let rollbackErr: string | null = null;
        try {
          const { error: delErr } = await supabase
            .from("projects").delete().eq("id", projectId);
          if (delErr) rollbackErr = delErr.message;
        } catch (e) {
          rollbackErr = e instanceof Error ? e.message : String(e);
        }
        return json(
          rollbackErr
            ? { error: aErr.message, rollback_error: rollbackErr }
            : { error: aErr.message },
          500,
        );
      }
    }

    return json({
      project_id: projectId,
      clickup_parent_task_id: parent.id,
      child_count: childCount,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

