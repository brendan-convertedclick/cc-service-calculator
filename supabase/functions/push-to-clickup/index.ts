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
//   1. Load quote + scope + brief + client + line_items_jsonb snapshot.
//   2. Resolve the client's ClickUp space (substring match on client name).
//      Cache clickup_folder_id on clients row.
//   3. Pick a list inside the space named /projects/i, or the first list.
//   4. Create a parent task named after brief.raw_subject.
//   5. For each line_item × allocation: create a child task with
//      time_estimate = hours * 60 * 60000 ms (matches /brief's convention),
//      optional assignee resolved from team_members, then post a BRIEF::
//      comment mirroring /brief's grammar.
//   6. Insert projects row + project_actuals rows (one per child, planned
//      hours from the snapshot allocation).
//
// Atomicity: we generate the project id client-side and only insert the
// projects row AFTER every ClickUp child task + comment succeeds. If any
// ClickUp call fails we bubble the error and never write to the DB — so
// retries are not blocked by the projects.quote_id unique constraint. If
// the project_actuals bulk insert fails after projects inserted, we run a
// compensating delete on the projects row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

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

    // Resolve the ClickUp space for the client (cache id on clients row).
    let spaceId = client.clickup_folder_id;
    if (!spaceId) {
      const spacesRes = await fetch(
        `https://api.clickup.com/api/v2/team/${settings.clickup_workspace_id}/space`,
        CU,
      );
      if (!spacesRes.ok) return json({ error: `CU spaces: ${await spacesRes.text()}` }, 502);
      const spaces = await spacesRes.json();
      const space = (spaces.spaces ?? []).find((s: { name: string }) =>
        s.name.toLowerCase().includes(client.name.toLowerCase()),
      );
      if (!space) return json({ error: `No ClickUp space found matching '${client.name}'` }, 404);
      spaceId = space.id;
      await supabase.from("clients").update({ clickup_folder_id: spaceId }).eq("id", client.id);
    }

    // Find a list inside the space. Prefer one named /projects/i.
    const listsRes = await fetch(`https://api.clickup.com/api/v2/space/${spaceId}/list`, CU);
    if (!listsRes.ok) return json({ error: `CU lists: ${await listsRes.text()}` }, 502);
    const lists = await listsRes.json();
    const projectsList =
      (lists.lists ?? []).find((l: { name: string }) => /projects/i.test(l.name)) ??
      (lists.lists ?? [])[0];
    if (!projectsList) return json({ error: "No list found in client space" }, 404);

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
      .select("id,full_name,email,primary_department_id")
      .is("archived_at", null);

    // Generate the project id up front so each actuals row can reference it
    // while we're still in the ClickUp loop. The projects row itself is
    // inserted LAST (after every ClickUp child succeeds) to keep the push
    // atomic — see the file header for the rationale.
    const projectId = crypto.randomUUID();

    const items = (quote.line_items_jsonb as SnapshotLineItem[]) ?? [];
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
            (t: { primary_department_id: string | null }) =>
              t.primary_department_id === alloc.dept_id,
          );
          // ClickUp v2 creates subtasks via the list endpoint with `parent`
          // in the body (NOT POST /task/{parent_id}, which isn't a real
          // endpoint). See https://developer.clickup.com/reference/createtask
          const childRes = await fetch(
            `https://api.clickup.com/api/v2/list/${projectsList.id}/task`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                name: `${item.service_name} — ${alloc.dept_name}`,
                parent: parent.id,
                assignees: assignee ? [Number(assignee.id)] : [],
                time_estimate: Math.round(alloc.hours * 60 * 60_000), // hours → ms
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
                comment_text: `BRIEF:: ${JSON.stringify({
                  client_name: client.name,
                  engagement_type: "Task",
                  work_stream: alloc.dept_name,
                  sprint_points: Math.max(1, Math.round(alloc.hours / 4)),
                  date_of_engagement: new Date().toISOString().slice(0, 10),
                  source_quote_id: quote.id,
                })}`,
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  };
}
