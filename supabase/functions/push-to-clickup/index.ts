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
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { addClickupChecklist, addClickupDependency, buildBriefComment, buildBriefTaskBody, findCustomField } from "../_shared/clickup.ts";
import { isMeetingWorkStream, mentionToken, MEETINGS_CHANNEL_ID, NEW_TASKS_CHANNEL_ID, postChatMessage } from "../_shared/clickup-chat.ts";
import { planMaterialisation, renderHowTo, type MaterialisePlan, type MaterialiseStep } from "../_shared/system-materialise.ts";
import { orderChildrenBySteps, type DeptChild } from "../_shared/dept-sequence.ts";

const APP_URL = "https://conductor.convertedclick.co.za";

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
    const body = await req.json();
    const { quote_id, git_remote_url } = body as {
      quote_id: string;
      git_remote_url?: string;
    };
    if (!quote_id) return json({ error: "quote_id required" }, 400);

    const supabase = createUserClient(req);

    const { token: clickupPat, via } = await getOperatorClickupToken(req);
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
          id: string;
          raw_subject: string | null;
          client_id: string;
          client: { id: string; name: string; clickup_folder_id: string | null; clickup_client_name: string | null } | null;
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

    // Reserve the project_code BEFORE creating the parent task so we can
    // stamp it into the task name and the Project Code custom field. The
    // generator function returns the NEXT available code; the BEFORE INSERT
    // trigger on projects re-runs it on insert — both will return the same
    // value because no other project insert can race in between (the
    // function is called from a single edge function invocation).
    const { data: codeRow, error: codeErr } = await supabase
      .rpc("generate_project_code");
    if (codeErr) return json({ error: `code gen: ${codeErr.message}` }, 500);
    const projectCode = codeRow as string;

    // Create parent task.
    const parentRes = await fetch(
      `https://api.clickup.com/api/v2/list/${projectsList.id}/task`,
      {
        ...CU,
        method: "POST",
        body: JSON.stringify({
          name: `[${projectCode}] ${scope.brief?.raw_subject ?? "Untitled project"}`,
          description: `Project from quote ${quote.id}\nProject code: ${projectCode}`,
        }),
      },
    );
    if (!parentRes.ok) return json({ error: `CU parent: ${await parentRes.text()}` }, 502);
    const parent = await parentRes.json();

    // Set custom fields on the parent task: project_code (text) +
    // four AI tracking fields initialised to 0. The Stop hook in
    // ~/.claude/hooks/stop-ai-cost.py increments the AI fields on every
    // Claude Code session end. Missing fields = warn + continue (the
    // ClickUp UI setup may lag behind a code deploy).
    type CfValue = { id: string; value: string | number };
    const parentFields: CfValue[] = [];
    const codeField = findCustomField(cuFields, "Project Code");
    if (codeField) {
      parentFields.push({ id: codeField.id, value: projectCode });
    } else {
      console.warn(`Custom field "Project Code" not found on list ${projectsList.id}`);
    }
    for (const fname of [
      "AI Input Tokens",
      "AI Output Tokens",
      "AI Cost ZAR",
      "AI Duration Minutes",
    ]) {
      const f = findCustomField(cuFields, fname);
      if (f) parentFields.push({ id: f.id, value: 0 });
    }

    // Set fields one-at-a-time via the per-field POST endpoint. PUT /task
    // silently drops custom fields — see CLAUDE.md and Quartz wiki entry.
    for (const f of parentFields) {
      const cfRes = await fetch(
        `https://api.clickup.com/api/v2/task/${parent.id}/field/${f.id}`,
        {
          ...CU,
          method: "POST",
          body: JSON.stringify({ value: f.value }),
        },
      );
      if (!cfRes.ok) {
        console.warn(
          `CU custom field ${f.id} on parent ${parent.id}: ${await cfRes.text()}`,
        );
      }
    }

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
          .select("id,default_due_days,clickup_work_stream,checklist_items")
          .in("id", serviceIds)
      : { data: [] };
    const dueDaysMap = new Map<string, number | null>(
      (svcRows ?? []).map((s: { id: string; default_due_days: number | null }) => [
        s.id,
        s.default_due_days,
      ]),
    );
    // Per-service Work Stream override (wins over the department mapping).
    const serviceWsOverride = new Map<string, string>(
      (svcRows ?? [])
        .filter((s: { clickup_work_stream: string | null }) => !!s.clickup_work_stream)
        .map((s: { id: string; clickup_work_stream: string }) => [s.id, s.clickup_work_stream]),
    );
    // Default checklist to stamp on every child task created from this service.
    const checklistMap = new Map<string, string[]>(
      (svcRows ?? [])
        .filter((s: { checklist_items: string[] | null }) => (s.checklist_items ?? []).length > 0)
        .map((s: { id: string; checklist_items: string[] }) => [s.id, s.checklist_items]),
    );
    // Resolve assignees from department → primary team member → clickup_user_id.
    const deptIds = [...new Set(items.flatMap((i) => i.allocation.map((a) => a.dept_id)))];
    const { data: deptRows } = deptIds.length > 0
      ? await supabase
          .from("departments")
          .select("id,name,primary_team_member_id,clickup_work_stream")
          .in("id", deptIds)
      : { data: [] };
    const deptOwnerMap = new Map<string, string | null>(
      (deptRows ?? []).map((d: { id: string; primary_team_member_id: string | null }) => [
        d.id,
        d.primary_team_member_id,
      ]),
    );
    // Department → ClickUp "Work Stream" option label (clickup_work_stream
    // override, else the department name).
    const deptWorkStreamById = new Map<string, string>(
      (deptRows ?? []).map((d: { id: string; name: string; clickup_work_stream: string | null }) => [
        d.id,
        d.clickup_work_stream ?? d.name,
      ]),
    );
    const teamById = new Map(
      (team ?? []).map((t: { id: string; clickup_user_id: number | null }) => [t.id, t]),
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
    const clientCf = resolveDropdownOption("Client Name", client.clickup_client_name ?? client.name);
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
    // Collected for the end-of-push ClickUp Chat summary message(s) — split by
    // work stream below (isMeetingWorkStream) so meeting tasks land in the
    // Meetings channel instead of New Tasks.
    const chatLines: Array<{ name: string; url: string; mention: string | null; workStream: string }> = [];
    let childCount = 0;
    // First-wins: the service × department task a materialise_as='checklist_item'
    // step (or a sub-step rolling up under a non-task parent) gets stamped onto.
    // A service can span several departments (several child tasks), and can even
    // appear as more than one quote line item — either way we pick the first
    // child created, in allocation order, rather than one-per-department/line —
    // see planMaterialisation below.
    // ponytail: single checklist target per service, not per department/line;
    // widen if a service with a multi-dept checklist step turns out to need it.
    const firstChildTaskIdByService = new Map<string, string>();
    // Every department child of a service, in creation order — chained into
    // "blocked by" links once the procedure's step order is known (below).
    const childrenByService = new Map<string, DeptChild[]>();

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
        batch.map(async ({ item, alloc }): Promise<{ row: ActualRow; chat: { name: string; url: string; mention: string | null; workStream: string }; serviceId: string; taskId: string; deptId: string; deptName: string }> => {
          const ownerId = deptOwnerMap.get(alloc.dept_id);
          const owner = ownerId ? teamById.get(ownerId) : null;

          const taskCf = [...sharedCustomFields];
          const workStreamLabel =
            serviceWsOverride.get(item.service_id) ?? deptWorkStreamById.get(alloc.dept_id) ?? alloc.dept_name;
          const wsCf = resolveDropdownOption("Work Stream", workStreamLabel);
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
                assignees: owner?.clickup_user_id ? [owner.clickup_user_id] : [],
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

          const checklistItems = checklistMap.get(item.service_id);
          if (checklistItems) await addClickupChecklist(clickupPat, child.id, checklistItems, owner?.clickup_user_id ?? null);

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

          const ownerRec = owner as { full_name?: string | null; email?: string | null; clickup_user_id?: number | null } | null;
          return {
            row: {
              project_id: projectId,
              clickup_task_id: child.id,
              dept_id: alloc.dept_id,
              planned_hours: alloc.hours,
            },
            chat: {
              name: `${item.service_name} — ${alloc.dept_name}`,
              url: child.url,
              mention: ownerRec
                ? mentionToken({ clickupUserId: ownerRec.clickup_user_id, name: ownerRec.full_name })
                : null,
              workStream: workStreamLabel,
            },
            serviceId: item.service_id,
            taskId: child.id,
            deptId: alloc.dept_id,
            deptName: alloc.dept_name,
          };
        }),
      );
      for (const r of results) {
        actualsRows.push(r.row);
        chatLines.push(r.chat);
        if (!firstChildTaskIdByService.has(r.serviceId)) {
          firstChildTaskIdByService.set(r.serviceId, r.taskId);
        }
        const siblings = childrenByService.get(r.serviceId) ?? [];
        siblings.push({ deptId: r.deptId, deptName: r.deptName, taskId: r.taskId });
        childrenByService.set(r.serviceId, siblings);
      }
      childCount += results.length;
    }

    // All ClickUp work succeeded — safe to write the projects row now.
    // Copy recurrence config from the quote — see the RecurrencePanel on the
    // quote build page. Whole-project mode is driven by projects.*, per_service
    // mode is driven by recurring_task_schedules rows inserted below.
    const q = quote as {
      id: string;
      recurrence_mode: "none" | "project" | "per_service";
      is_recurring: boolean | null;
      recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly" | null;
      recurrence_start: string | null;
      recurrence_end: string | null;
    };
    const { error: pErr } = await supabase
      .from("projects")
      .insert({
        id: projectId,
        quote_id: quote.id,
        clickup_parent_task_id: parent.id,
        name: scope.brief?.raw_subject ?? "Untitled project",
        project_code: projectCode,
        git_remote_url: git_remote_url ?? null,
        status: "in_progress",
        recurrence_mode: q.recurrence_mode,
        is_recurring: q.recurrence_mode === "project",
        recurrence_interval: q.recurrence_mode === "project" ? q.recurrence_interval : null,
        recurrence_start: q.recurrence_mode === "project" ? q.recurrence_start : null,
        recurrence_end: q.recurrence_mode === "project" ? q.recurrence_end : null,
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

    // Per-service recurrence: seed recurring_task_schedules rows for each
    // quote line flagged is_recurring. The cron picks these up and creates
    // the next cycle's tasks. Whole-project mode doesn't populate this table
    // — it's handled by projects.is_recurring in the cron instead.
    if (q.recurrence_mode === "per_service") {
      const { data: qsRows } = await supabase
        .from("quote_services")
        .select("service_id,is_recurring,recurrence_interval,recurrence_start,recurrence_end")
        .eq("quote_id", quote.id)
        .eq("is_recurring", true);

      const recurringByServiceId = new Map<
        string,
        {
          recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly";
          recurrence_start: string;
          recurrence_end: string | null;
        }
      >();
      for (const r of (qsRows ?? []) as Array<{
        service_id: string;
        recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly" | null;
        recurrence_start: string | null;
        recurrence_end: string | null;
      }>) {
        if (!r.recurrence_interval || !r.recurrence_start) continue;
        recurringByServiceId.set(r.service_id, {
          recurrence_interval: r.recurrence_interval,
          recurrence_start: r.recurrence_start,
          recurrence_end: r.recurrence_end,
        });
      }

      const scheduleRows = tasks
        .map(({ item, alloc }) => {
          const cfg = recurringByServiceId.get(item.service_id);
          if (!cfg) return null;
          return {
            project_id: projectId,
            service_id: item.service_id,
            dept_id: alloc.dept_id,
            planned_hours: alloc.hours,
            clickup_parent_task_id: parent.id,
            clickup_list_id: projectsList.id,
            recurrence_interval: cfg.recurrence_interval,
            recurrence_anchor: cfg.recurrence_start,
            next_due_at: cfg.recurrence_start,
            source: "per_item",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (scheduleRows.length > 0) {
        await supabase.from("recurring_task_schedules").insert(scheduleRows);
      }
    }

    // Instantiate process steps for this project.
    // Each service on the quote may have template steps in process_steps —
    // OR, once its kind='service' system has a published revision (Phase 5),
    // that revision's frozen body snapshot instead. We create one
    // process_step_instance per resolved template step, in service-line
    // order, then create a corresponding ClickUp child task for each.
    const serviceIdsOrdered = items.map((i) => i.service_id);
    if (serviceIdsOrdered.length > 0) {
      type TemplateStep = {
        id: string;
        service_id: string;
        ordinal: number;
        title: string;
        description: string | null;
        department_id: string | null;
        estimated_hours: number | string | null;
        materialise_as: "task" | "checklist_item" | "none";
        owner_id: string | null;
        system_id: string | null;
        doc_links: string[] | null;
      };
      type SubStepRow = { id: string; parent_id: string | null; title: string; description: string | null; ordinal: number; materialise_as: "task" | "checklist_item" | "none" };
      // Shape of a row inside system_revisions.body: a full process_steps
      // snapshot (top-level AND sub-steps — parent_id tells them apart).
      type BodyStep = TemplateStep & { parent_id: string | null };

      // Materialisation rule (Phase 5, spec "Error handling"): a service's
      // kind='service' system, if it has a published revision, materialises
      // from that frozen snapshot; a system with none — or no system at all
      // (pre-Phase-4 services) — falls back to live process_steps, exactly
      // as Phase 1-4 behaved. Reachability today: current_revision_id is
      // only ever set by publish_system_revision, and nothing calls it yet
      // outside the (new) Systems approval UI — so on the live DB every
      // service currently takes the fallback branch below. Wired, not yet
      // exercised.
      const { data: serviceSystems } = await supabase
        .from("system_definitions")
        .select("id,service_id,current_revision_id")
        .in("service_id", serviceIdsOrdered)
        .eq("kind", "service")
        // system_definitions_one_per_service_idx (0107) only guarantees one
        // service-kind system per service *while archived_at is null* — so an
        // archived system that still carries a current_revision_id would
        // otherwise win publishedBodyByServiceId below and materialise a
        // retired snapshot over the live one.
        .is("archived_at", null);
      type ServiceSystem = { id: string; service_id: string; current_revision_id: string | null };
      const revisionIds = ((serviceSystems ?? []) as ServiceSystem[])
        .map((s) => s.current_revision_id)
        .filter((id): id is string => !!id);
      const { data: publishedRevs } = revisionIds.length > 0
        ? await supabase.from("system_revisions").select("system_id,body").in("id", revisionIds).eq("state", "published")
        : { data: [] as { system_id: string; body: unknown }[] };
      const serviceIdBySystemId = new Map(
        ((serviceSystems ?? []) as ServiceSystem[]).map((s) => [s.id, s.service_id]),
      );
      // Defensive backstop: a published body with zero TOP-LEVEL steps is
      // treated as "no published revision" rather than "materialise
      // nothing" — protects against any snapshot source (present or
      // future) that fails to stamp system_id on every step and so
      // silently captures an empty/partial body. Falls through to the raw
      // process_steps query + warning below instead of vanishing.
      const publishedBodyByServiceId = new Map<string, BodyStep[]>();
      for (const rev of (publishedRevs ?? []) as { system_id: string; body: unknown }[]) {
        const svcId = serviceIdBySystemId.get(rev.system_id);
        if (!svcId) continue;
        const body = (rev.body as BodyStep[] | null) ?? [];
        if (body.some((s) => !s.parent_id)) publishedBodyByServiceId.set(svcId, body);
      }

      const servicesNeedingRaw = serviceIdsOrdered.filter((id) => !publishedBodyByServiceId.has(id));
      for (const id of servicesNeedingRaw) {
        console.warn(`[push-to-clickup] service ${id} has no published system revision — materialising from live process_steps`);
      }

      const { data: rawTopLevel } = servicesNeedingRaw.length > 0
        ? await supabase
            .from("process_steps")
            .select("id,service_id,ordinal,title,description,department_id,estimated_hours,materialise_as,owner_id,system_id,doc_links")
            .in("service_id", servicesNeedingRaw)
            .is("parent_id", null) // top-level only — sub-steps become a checklist item, not their own task
            .order("service_id,ordinal")
        : { data: [] as TemplateStep[] };
      const rawTopLevelIds = ((rawTopLevel ?? []) as TemplateStep[]).map((s) => s.id);
      const { data: rawSubSteps } = rawTopLevelIds.length > 0
        ? await supabase
            .from("process_steps")
            .select("id,parent_id,title,description,ordinal,materialise_as")
            .in("parent_id", rawTopLevelIds)
            .order("ordinal")
        : { data: [] as SubStepRow[] };

      // Body-sourced steps: split the snapshot by parent_id and stamp
      // service_id (the snapshot is scoped to a system, not a column on the
      // row itself). Guard against a step deleted since publish — inserting
      // a process_step_instance with a template_step_id that no longer
      // exists in process_steps would 23503 the whole batch insert below.
      const bodyTopLevel: TemplateStep[] = [];
      const bodySubSteps: SubStepRow[] = [];
      for (const [serviceId, steps] of publishedBodyByServiceId) {
        for (const s of steps) {
          if (s.parent_id) {
            bodySubSteps.push({ id: s.id, parent_id: s.parent_id, title: s.title, description: s.description ?? null, ordinal: s.ordinal, materialise_as: s.materialise_as });
          } else {
            bodyTopLevel.push({
              id: s.id,
              service_id: serviceId,
              ordinal: s.ordinal,
              title: s.title,
              description: s.description ?? null,
              department_id: s.department_id ?? null,
              estimated_hours: s.estimated_hours ?? null,
              materialise_as: s.materialise_as,
              owner_id: s.owner_id ?? null,
              system_id: s.system_id ?? null,
              // Left null on purpose: read live from process_steps below, so a
              // document that moves reaches every future task without
              // republishing the revision (same rule as 0129's system links).
              doc_links: null,
            });
          }
        }
      }
      const bodyStepIds = [...bodyTopLevel, ...bodySubSteps].map((s) => s.id);
      const { data: stillLive } = bodyStepIds.length > 0
        ? await supabase.from("process_steps").select("id,doc_links").in("id", bodyStepIds)
        : { data: [] as { id: string; doc_links: string[] | null }[] };
      const liveIds = new Set((stillLive ?? []).map((r) => r.id));
      const liveDocLinksByStepId = new Map(
        (stillLive ?? []).map((r: { id: string; doc_links: string[] | null }) => [r.id, r.doc_links ?? []]),
      );
      const droppedCount = bodyStepIds.filter((id) => !liveIds.has(id)).length;
      if (droppedCount > 0) {
        console.warn(`[push-to-clickup] ${droppedCount} step(s) in a published revision snapshot no longer exist in process_steps; skipping`);
      }

      const templateSteps: TemplateStep[] = [
        ...((rawTopLevel ?? []) as TemplateStep[]),
        ...bodyTopLevel.filter((s) => liveIds.has(s.id)),
      ];
      const subStepRows: SubStepRow[] = [
        ...((rawSubSteps ?? []) as SubStepRow[]),
        ...bodySubSteps.filter((s) => liveIds.has(s.id)),
      ];

      const templateStepsById = new Map(templateSteps.map((s) => [s.id, s]));

      // Handover order: chain each service's department children so Creative
      // is blocked by Content and Development by Creative, instead of all
      // three landing as three unordered tasks. The sequence comes from the
      // service's own procedure (orderChildrenBySteps) — departments.display_order
      // is a catalogue order, not a delivery order — so a service whose steps
      // carry no department gets no links rather than a guessed chain.
      // Best-effort: the tasks and the projects row already exist.
      for (const [serviceId, children] of childrenByService) {
        const ordered = orderChildrenBySteps(
          children,
          templateSteps.filter((s) => s.service_id === serviceId),
        );
        if (ordered.length < 2) continue;
        for (let i = 1; i < ordered.length; i++) {
          await addClickupDependency(clickupPat, ordered[i].taskId, ordered[i - 1].taskId);
        }
        console.log(
          `[push-to-clickup] chained ${ordered.length} department tasks for service ${serviceId}: ${ordered.map((c) => c.deptName).join(" → ")}`,
        );
      }

      // Internal-system guard (spec "Error handling"): kind='internal' systems
      // attribute time via the perpetual [Internal] {member} — {category} task
      // (provision-ongoing-tasks), never a project ClickUp task. Not reachable
      // today — templateSteps above is queried by service_id, and kind='internal'
      // systems carry time_category_id, not service_id — but guard cheaply anyway.
      const stepSystemIds = [...new Set(
        templateSteps.map((s) => s.system_id).filter((id): id is string => !!id),
      )];
      // doc_links rides along on the query that was already fetching `kind`:
      // the reference documents on a system get rendered into every task the
      // system raises, so the person doing the work opens them from ClickUp.
      // Read live rather than from the published revision snapshot — a doc that
      // moves should update every future task without republishing (0129).
      type SystemRow = { id: string; kind: string; doc_links: string[] | null };
      const { data: systemRows } = stepSystemIds.length > 0
        ? await supabase.from("system_definitions").select("id,kind,doc_links").in("id", stepSystemIds)
        : { data: [] as SystemRow[] };
      const systemKindById = new Map((systemRows ?? []).map((s: SystemRow) => [s.id, s.kind]));
      const docLinksBySystemId = new Map((systemRows ?? []).map((s: SystemRow) => [s.id, s.doc_links ?? []]));
      const internalStepIds = new Set(
        templateSteps
          .filter((s) => s.system_id && systemKindById.get(s.system_id) === "internal")
          .map((s) => s.id),
      );

      // Sub-steps roll into a ClickUp artefact per the materialise_as matrix
      // (P3 — see plan / system-materialise.ts): a checklist item on their
      // parent's task, or — if the parent itself isn't materialise_as='task'
      // — a sibling item on the service × department task instead.
      // planMaterialisation (pure, tested separately) makes that call; here we
      // just group steps by service and feed it.
      const stepsByService = new Map<string, MaterialiseStep[]>();
      for (const s of (templateSteps ?? []) as TemplateStep[]) {
        if (internalStepIds.has(s.id)) continue; // internal-system guard, see above
        const arr = stepsByService.get(s.service_id) ?? [];
        arr.push({ id: s.id, parent_id: null, ordinal: s.ordinal, title: s.title, description: s.description, materialise_as: s.materialise_as });
        stepsByService.set(s.service_id, arr);
      }
      for (const sub of (subStepRows ?? []) as SubStepRow[]) {
        const parentStep = sub.parent_id ? templateStepsById.get(sub.parent_id) : undefined;
        if (!parentStep) continue; // scoped to topLevelIds above — shouldn't happen
        if (internalStepIds.has(parentStep.id)) continue; // internal-system guard, see above
        const arr = stepsByService.get(parentStep.service_id) ?? [];
        arr.push({ id: sub.id, parent_id: sub.parent_id, ordinal: sub.ordinal, title: sub.title, description: sub.description, materialise_as: sub.materialise_as });
        stepsByService.set(parentStep.service_id, arr);
      }
      const materialisePlanByService = new Map(
        [...stepsByService.entries()].map(([serviceId, steps]) => [serviceId, planMaterialisation(steps)]),
      );
      // Keyed by top-level template step id -> the plan entry for ITS task
      // (only populated for materialise_as='task' steps). Carries the checklist
      // and the prose, because the working instructions have to be rendered
      // into the task's description — a checklist item has nowhere to put them.
      const planByStepId = new Map<string, MaterialisePlan["tasks"][number]>();
      for (const plan of materialisePlanByService.values()) {
        for (const t of plan.tasks) planByStepId.set(t.stepId, t);
      }
      const serviceNameById = new Map(items.map((i) => [i.service_id, i.service_name]));

      if (templateSteps && templateSteps.length > 0) {
        // Global ordinal: sort by quote service order, then template step ordinal
        const serviceOrderMap = new Map(serviceIdsOrdered.map((id, i) => [id, i]));
        const sorted = [...templateSteps].sort((a, b) => {
          const so = (serviceOrderMap.get(a.service_id) ?? 99) - (serviceOrderMap.get(b.service_id) ?? 99);
          return so !== 0 ? so : a.ordinal - b.ordinal;
        });

        const instanceRows = sorted.map((step, idx) => ({
          project_id: projectId,
          template_step_id: step.id,
          service_id: step.service_id,
          ordinal: idx + 1,
          title: step.title,
          description: step.description ?? null,
          department_id: step.department_id ?? null,
          estimated_hours: step.estimated_hours ?? null,
          status: "pending",
        }));

        const { data: inserted, error: stepInsertErr } = await supabase
          .from("process_step_instances")
          .insert(instanceRows)
          .select("id,ordinal,title,description,department_id,estimated_hours,service_id,template_step_id");

        if (stepInsertErr) {
          console.error("Failed to instantiate process steps:", stepInsertErr.message);
          // Non-fatal: project creation succeeds even if step instantiation fails
        } else if (inserted) {
          // Create one ClickUp child task per step instance via buildBriefTaskBody
          // so it carries the same fidelity as the service×department child
          // (assignee, time_estimate, points, due date, Work Stream) instead of
          // just name+parent — see plan Phase 1 / spec C1.
          const dateOfEngagement = new Date().toISOString().slice(0, 10);
          for (const instance of inserted as Array<{
            id: string;
            ordinal: number;
            title: string;
            description: string | null;
            department_id: string | null;
            estimated_hours: number | string | null;
            service_id: string;
            template_step_id: string;
          }>) {
            // materialise_as='none' and 'checklist_item' steps keep their
            // process_step_instance row (the workflow timeline stays
            // complete) but get no ClickUp task of their own — 'none' is
            // just dropped; 'checklist_item' is folded into the service ×
            // department task's checklist below instead.
            // Internal-system guard first, so it logs regardless of materialise_as
            // (a checklist_item/none internal step never reaches the task check below).
            if (internalStepIds.has(instance.template_step_id)) {
              console.warn(`[push-to-clickup] step ${instance.id} belongs to a kind='internal' system; skipping ClickUp task creation`);
              continue;
            }
            const materialiseAs = templateStepsById.get(instance.template_step_id)?.materialise_as ?? "task";
            if (materialiseAs !== "task") continue;
            try {
              const hours = instance.estimated_hours != null ? Number(instance.estimated_hours) : null;
              // Assignee chain (P4, widened): process_steps.owner_id first, falling
              // back to department → primary team member. deptOwnerMap/deptWorkStreamById
              // cover only this quote's frozen snapshot departments — a step whose
              // department isn't in the snapshot silently omits the fallback rather
              // than re-querying.
              // Resolve on clickup_user_id, not the row: an owner_id that maps to a
              // live team_member with no clickup_user_id has NOT resolved (spec: "owner_id
              // → team_members.clickup_user_id; fall back to primary_team_member_id").
              const stepTemplateOwnerId = templateStepsById.get(instance.template_step_id)?.owner_id ?? null;
              const deptOwnerId = instance.department_id ? deptOwnerMap.get(instance.department_id) : null;
              const stepAssigneeClickupId =
                (stepTemplateOwnerId && teamById.get(stepTemplateOwnerId)?.clickup_user_id) ||
                (deptOwnerId && teamById.get(deptOwnerId)?.clickup_user_id) ||
                null;
              const workStream =
                (instance.department_id && deptWorkStreamById.get(instance.department_id)) ||
                serviceWsOverride.get(instance.service_id) ||
                "Ad-hoc";
              const stepDueDays = dueDaysMap.get(instance.service_id);
              const now = Date.now();
              const stepDueDateMs = stepDueDays ? now + stepDueDays * 24 * 60 * 60 * 1000 : null;

              // A task's name is the name someone wrote for it, prefixed with
              // the service so it reads in a ClickUp list: "3D Configurator —
              // On-page SEO and indexing". Not the department (that is the Work
              // Stream field and it already picks the list), and not "[Step N]"
              // — a task is not a step, and Conductor's step numbers count
              // across the whole procedure, so they mean nothing on one task.
              const plannedTask = planByStepId.get(instance.template_step_id);
              const serviceName = serviceNameById.get(instance.service_id);
              const templateStep = templateStepsById.get(instance.template_step_id);
              const stepSystemId = templateStep?.system_id ?? null;
              // The task's own documents first, then the procedure's — one
              // "Reference docs" list, most specific at the top. Deduped
              // because a link pinned to a task is often also on the shelf.
              const docLinks = [...new Set([
                ...(liveDocLinksByStepId.get(instance.template_step_id) ?? templateStep?.doc_links ?? []),
                ...(stepSystemId ? docLinksBySystemId.get(stepSystemId) ?? [] : []),
              ])];
              const howTo = plannedTask
                ? renderHowTo(
                    plannedTask,
                    {
                      label: "How this is done — the procedure in Conductor",
                      url: `${APP_URL}/systems/${stepSystemId ?? ""}`,
                    },
                    docLinks,
                  )
                : null;

              const taskBody: Record<string, unknown> = {
                ...buildBriefTaskBody(cuFields, {
                  name: serviceName ? `${serviceName} — ${instance.title}` : instance.title,
                  description: howTo ?? instance.description ?? "",
                  clientName: client.clickup_client_name ?? client.name,
                  workStream,
                  engagementType: "Task",
                  sprintPoints: hours != null ? Math.min(10, Math.max(1, Math.round(hours / 4))) : 1,
                  dateOfEngagement,
                  assigneeClickupId: stepAssigneeClickupId,
                  dueDateMs: stepDueDateMs,
                  timeEstimateMs: hours != null ? hours * 3_600_000 : null,
                }),
                parent: parent.id,
                // buildBriefTaskBody doesn't set start_date (schedule-brief-tasks
                // never wants one); the service×department child sibling above
                // does, alongside due_date — match it here.
                ...(stepDueDateMs !== null && { start_date: now, start_date_time: false }),
                // Sent alongside `description`, not instead of it: ClickUp
                // renders the markdown when it understands the field and still
                // has the plain copy if it doesn't, so the instructions can't
                // go missing either way.
                ...(howTo ? { markdown_description: howTo } : {}),
              };

              const stepTaskUrl = `https://api.clickup.com/api/v2/list/${projectsList.id}/task`;
              let stepTaskRes = await fetch(stepTaskUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
              // ClickUp rejects very large sprint-point values on create; retry
              // once without `points` rather than lose the whole step task
              // (same pattern as schedule-brief-tasks).
              if (!stepTaskRes.ok && "points" in taskBody) {
                const errText = await stepTaskRes.text();
                console.warn(`[push-to-clickup] step task create failed with points (${stepTaskRes.status}: ${errText}); retrying without points`);
                const { points: _dropped, ...noPoints } = taskBody;
                stepTaskRes = await fetch(stepTaskUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
              }
              if (stepTaskRes.ok) {
                const stepTask = await stepTaskRes.json();
                await supabase
                  .from("process_step_instances")
                  .update({ clickup_task_id: stepTask.id })
                  .eq("id", instance.id);
                // The task's steps become its checklist (P2/P3 — see plan).
                // Titles only: an item is a name and a tick, which is why the
                // step descriptions went into markdown_description above.
                // Non-fatal: addClickupChecklist already swallows its own errors.
                const checklist = plannedTask?.checklist ?? [];
                if (checklist.length > 0) {
                  await addClickupChecklist(
                    clickupPat,
                    stepTask.id,
                    checklist.map((c) => c.title),
                    stepAssigneeClickupId,
                  );
                }
              }
            } catch (e) {
              console.error(`Failed to create ClickUp task for step ${instance.ordinal}:`, e);
              // Continue — remaining steps should still be created
            }
          }
        }
      }

      // materialise_as='checklist_item' top-level steps, plus any sub-steps
      // that roll up under a non-task parent, land on the service ×
      // department task — the first child created for that service (see
      // firstChildTaskIdByService above). Non-fatal: addClickupChecklist
      // already swallows its own errors.
      // Runs AFTER the projects row is committed, so a throw here would 500 a
      // push that actually succeeded and leave the quote un-retryable (unique
      // constraint on projects.quote_id) — same reason the step-task checklist
      // call above is wrapped. addClickupChecklist swallows HTTP errors but not
      // a network-level fetch rejection.
      for (const [serviceId, plan] of materialisePlanByService) {
        if (plan.serviceChecklist.length === 0) continue;
        const taskId = firstChildTaskIdByService.get(serviceId);
        if (!taskId) {
          console.error(`[push-to-clickup] no service×department task for service ${serviceId}; dropped ${plan.serviceChecklist.length} checklist item(s)`);
          continue;
        }
        try {
          await addClickupChecklist(clickupPat, taskId, plan.serviceChecklist.map((c) => c.title));
        } catch (e) {
          console.error(`[push-to-clickup] service checklist failed for service ${serviceId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Notify the workspace-wide channels with ONE summary message per channel
    // (not one-per-task — avoids channel spam). Meeting-work-stream lines
    // (Internal Meeting / Client Meeting) go to Meetings, everything else to
    // New Tasks — a push can contain both, hence two possible messages.
    // Best-effort: the project is already created, so a failed post must
    // never fail the request — log and move on. Global channels, not the
    // client's own (2026-08-06) — client channels stay human-only; clients
    // aren't members of either one.
    const workspaceId = settings.clickup_workspace_id ? String(settings.clickup_workspace_id) : undefined;
    const projectName = scope.brief?.raw_subject ?? client.name;

    async function notifyChannel(channelId: string, lines: typeof chatLines) {
      if (lines.length === 0) return;
      const header = `🆕 ${lines.length} task${lines.length === 1 ? "" : "s"} briefed for ${client!.name} — ${projectName}`;
      const bullets = lines
        .map((l) => `- ${l.mention ? `${l.mention} · ` : ""}${l.name} · ${l.url}`)
        .join("\n");
      const chatBody = `${header}\n${bullets}`;

      // Retry with linear backoff to ride out a transient ClickUp chat 5xx/429
      // (3 attempts @ 0/500/1000ms) instead of silently dropping the ping.
      let chatRes = await postChatMessage(clickupPat, channelId, chatBody, workspaceId);
      for (let attempt = 1; attempt < 3 && !chatRes.ok; attempt++) {
        await new Promise((r) => setTimeout(r, attempt * 500));
        console.warn(
          `[push-to-clickup] chat notify retry ${attempt} for project ${projectId} (channel ${channelId}): prev ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
        chatRes = await postChatMessage(clickupPat, channelId, chatBody, workspaceId);
      }

      if (!chatRes.ok) {
        console.error(
          `[push-to-clickup] chat notify FAILED after retries for project ${projectId} (channel ${channelId}): ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
        // Surface the miss on the brief timeline so it's not invisible.
        const failBriefId = scope.brief?.id;
        if (failBriefId) {
          try {
            await supabase.from("brief_messages").insert({
              brief_id: failBriefId,
              gmail_message_id: `note-${crypto.randomUUID()}`,
              direction: "note",
              body_text:
                `⚠ Channel notification did not send for this push (ClickUp chat ${chatRes.status ?? "error"}). ` +
                `The project and ${lines.length} task${lines.length === 1 ? "" : "s"} were created fine — only the channel ping failed. Re-send it manually if needed.`,
              relayed_by: "conductor",
              sent_at: new Date().toISOString(),
              to_emails: [],
              cc_emails: [],
            });
          } catch (noteEx) {
            console.error(`[push-to-clickup] chat-fail note insert threw for project ${projectId}: ${noteEx instanceof Error ? noteEx.message : String(noteEx)}`);
          }
        }
      }
    }

    const meetingChatLines = chatLines.filter((l) => isMeetingWorkStream(l.workStream));
    const taskChatLines = chatLines.filter((l) => !isMeetingWorkStream(l.workStream));
    await notifyChannel(NEW_TASKS_CHANNEL_ID, taskChatLines);
    await notifyChannel(MEETINGS_CHANNEL_ID, meetingChatLines);

    return json({
      project_id: projectId,
      project_code: projectCode,
      clickup_parent_task_id: parent.id,
      child_count: childCount,
      via,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

