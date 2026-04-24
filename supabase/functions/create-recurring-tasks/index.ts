// supabase/functions/create-recurring-tasks/index.ts
//
// Cron-triggered function that creates ClickUp child tasks for recurring
// projects. Runs daily (or on-demand via POST).
//
// Driven by projects.is_recurring. For each active recurring project:
//   1. Compute which cycles need to be created based on
//      last_recurring_cycle_at (or recurrence_start if null) and the
//      project's recurrence_interval. Stop at today and at recurrence_end.
//   2. Read project_actuals for the project — one row per original child
//      task — as the template set to duplicate.
//   3. Look up the ClickUp list id from the parent task (once per project).
//   4. For each cycle × actual: create a child task under the parent,
//      post a BRIEF:: comment, insert a new project_actuals row.
//   5. Advance projects.last_recurring_cycle_at to the newest cycle.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { buildBriefComment } from "../_shared/clickup.ts";
import { advanceDate } from "../_shared/recurrence.ts";

type Interval = "weekly" | "biweekly" | "monthly" | "quarterly";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const supabase = createServiceRoleClient();

    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: settings } = await supabase
      .from("settings")
      .select("clickup_enabled")
      .eq("id", 1)
      .single();
    if (!settings?.clickup_enabled) return json({ skipped: true, reason: "ClickUp disabled" });

    const today = new Date().toISOString().slice(0, 10);

    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id,name,quote_id,clickup_parent_task_id,status,is_recurring,recurrence_interval,recurrence_start,recurrence_end,last_recurring_cycle_at")
      .eq("is_recurring", true)
      .eq("status", "in_progress")
      .not("recurrence_interval", "is", null)
      .not("recurrence_start", "is", null);
    if (projErr) return json({ error: projErr.message }, 500);

    // Skip projects whose end date has passed. `active` may be empty if no
    // whole-project recurrence exists; per-service schedules are processed
    // separately below.
    const active = (projects ?? []).filter(
      (p) => !p.recurrence_end || p.recurrence_end >= today,
    );

    const CU = {
      headers: {
        Authorization: clickupPat,
        "Content-Type": "application/json",
      },
    };

    // Resolve client names via project → quote → scope → brief → client for
    // the Client Name custom field.
    const quoteIds = [...new Set(active.map((p) => p.quote_id).filter(Boolean))];
    const clientByProject = new Map<string, string>();
    if (quoteIds.length > 0) {
      const { data: quotes } = await supabase
        .from("quotes")
        .select("id,scope:scopes(brief:briefs(client:clients(name)))")
        .in("id", quoteIds);
      for (const q of (quotes ?? []) as Array<{
        id: string;
        scope?: { brief?: { client?: { name: string } } };
      }>) {
        const name = q?.scope?.brief?.client?.name;
        if (!name) continue;
        const proj = active.find((p) => p.quote_id === q.id);
        if (proj) clientByProject.set(proj.id, name);
      }
    }

    // Preload departments + team members for assignee resolution.
    const [deptsRes, teamRes] = await Promise.all([
      supabase.from("departments").select("id,name,primary_team_member_id"),
      supabase
        .from("team_members")
        .select("id,clickup_user_id")
        .is("archived_at", null),
    ]);
    const deptMap = new Map(
      (deptsRes.data ?? []).map((d) => [d.id, d]),
    );
    const teamMap = new Map(
      (teamRes.data ?? []).map((t) => [t.id, t]),
    );

    let createdTotal = 0;
    const errors: string[] = [];

    for (const project of active) {
      try {
        const baseDate = project.last_recurring_cycle_at
          ? advanceDate(
              new Date(project.last_recurring_cycle_at),
              project.recurrence_interval as Interval,
            )
          : new Date(project.recurrence_start!);

        const cycles: Date[] = [];
        let cursor = baseDate;
        const endCap = project.recurrence_end ? new Date(project.recurrence_end) : null;
        const todayDate = new Date(today);
        while (cursor <= todayDate) {
          if (endCap && cursor > endCap) break;
          cycles.push(new Date(cursor));
          cursor = advanceDate(cursor, project.recurrence_interval as Interval);
        }
        if (cycles.length === 0) continue;

        // Fetch the project's actuals as the template set.
        const { data: actuals } = await supabase
          .from("project_actuals_current")
          .select("dept_id,planned_hours,clickup_task_id")
          .eq("project_id", project.id);
        if (!actuals?.length) continue;

        // Resolve the list id from the parent task once per project.
        const parentRes = await fetch(
          `https://api.clickup.com/api/v2/task/${project.clickup_parent_task_id}`,
          CU,
        );
        if (!parentRes.ok) {
          errors.push(
            `Project ${project.id}: failed to fetch parent task — ${await parentRes.text()}`,
          );
          continue;
        }
        const parent = await parentRes.json();
        const listId = parent?.list?.id;
        if (!listId) {
          errors.push(`Project ${project.id}: parent task has no list id`);
          continue;
        }

        // Fetch custom field definitions once per list.
        type CuField = {
          id: string;
          name: string;
          type: string;
          type_config?: { options?: Array<{ id: string; name: string }> };
        };
        const fieldsRes = await fetch(
          `https://api.clickup.com/api/v2/list/${listId}/field`,
          CU,
        );
        const cuFields: CuField[] = fieldsRes.ok
          ? ((await fieldsRes.json()).fields ?? [])
          : [];

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

        const clientName = clientByProject.get(project.id) ?? "Unknown";
        const dateField = cuFields.find(
          (f) => f.name === "Date of Engagement" && f.type === "date",
        );

        let lastCycleCreated: Date | null = null;

        for (const cycleDate of cycles) {
          for (const a of actuals as Array<{
            dept_id: string | null;
            planned_hours: number | string;
            clickup_task_id: string;
          }>) {
            if (!a.dept_id) continue;
            const dept = deptMap.get(a.dept_id);
            if (!dept) continue;
            const owner = dept.primary_team_member_id
              ? teamMap.get(dept.primary_team_member_id)
              : null;

            const plannedHours = Number(a.planned_hours);
            const cycleIso = cycleDate.toISOString().slice(0, 10);

            const cf: Array<{ id: string; value: string | number }> = [];
            const clientCf = resolveDropdownOption("Client Name", clientName);
            if (clientCf) cf.push(clientCf);
            const engCf = resolveDropdownOption("Engagement Type", "Task");
            if (engCf) cf.push(engCf);
            const wsCf = resolveDropdownOption("Work Stream", dept.name);
            if (wsCf) cf.push(wsCf);
            if (dateField) cf.push({ id: dateField.id, value: cycleDate.getTime() });

            const childRes = await fetch(
              `https://api.clickup.com/api/v2/list/${listId}/task`,
              {
                ...CU,
                method: "POST",
                body: JSON.stringify({
                  name: `${project.name} — ${dept.name} (${cycleIso})`,
                  parent: project.clickup_parent_task_id,
                  assignees: owner?.clickup_user_id ? [owner.clickup_user_id] : [],
                  time_estimate: Math.round(plannedHours * 60 * 60_000),
                  points: Math.min(10, Math.max(1, Math.round(plannedHours / 4))),
                  due_date: cycleDate.getTime(),
                  due_date_time: false,
                  start_date: cycleDate.getTime(),
                  start_date_time: false,
                  ...(cf.length > 0 && { custom_fields: cf }),
                }),
              },
            );
            if (!childRes.ok) {
              errors.push(
                `Project ${project.id} cycle ${cycleIso}: CU task failed — ${await childRes.text()}`,
              );
              continue;
            }
            const child = await childRes.json();

            await fetch(`https://api.clickup.com/api/v2/task/${child.id}/comment`, {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                comment_text: buildBriefComment({
                  client_name: clientName,
                  engagement_type: "Task",
                  work_stream: dept.name,
                  sprint_points: Math.max(1, Math.round(plannedHours / 4)),
                  date_of_engagement: cycleIso,
                  source_quote_id: project.quote_id,
                }),
              }),
            });

            await supabase.from("project_actuals").insert({
              project_id: project.id,
              clickup_task_id: child.id,
              dept_id: a.dept_id,
              planned_hours: plannedHours,
            });

            createdTotal++;
          }
          lastCycleCreated = cycleDate;
        }

        if (lastCycleCreated) {
          await supabase
            .from("projects")
            .update({
              last_recurring_cycle_at: lastCycleCreated.toISOString().slice(0, 10),
            })
            .eq("id", project.id);
        }
      } catch (e) {
        errors.push(
          `Project ${project.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // ---------- Per-service mode ----------
    // Schedules populated by push-to-clickup when recurrence_mode='per_service'.
    // Each row recurs on its own schedule; advance next_due_at per fire.
    const { data: dueSchedules } = await supabase
      .from("recurring_task_schedules")
      .select(
        "id,project_id,service_id,dept_id,planned_hours,clickup_parent_task_id,clickup_list_id,recurrence_interval,next_due_at",
      )
      .eq("status", "active")
      .lte("next_due_at", new Date().toISOString());

    if (dueSchedules?.length) {
      // Skip schedules for projects that aren't in_progress anymore.
      const scheduleProjectIds = [
        ...new Set((dueSchedules as Array<{ project_id: string }>).map((s) => s.project_id)),
      ];
      const { data: schedProjRows } = await supabase
        .from("projects")
        .select("id,name,status,quote_id")
        .in("id", scheduleProjectIds);
      const schedProjMap = new Map(
        (schedProjRows ?? []).map((p) => [p.id, p]),
      );

      // Fetch client names for schedule projects (same chain as whole-project mode).
      const schedQuoteIds = [
        ...new Set(
          (schedProjRows ?? [])
            .map((p) => p.quote_id)
            .filter((v): v is string => !!v),
        ),
      ];
      const schedClientByProject = new Map<string, string>();
      if (schedQuoteIds.length > 0) {
        const { data: schedQuotes } = await supabase
          .from("quotes")
          .select("id,scope:scopes(brief:briefs(client:clients(name)))")
          .in("id", schedQuoteIds);
        for (const sq of (schedQuotes ?? []) as Array<{
          id: string;
          scope?: { brief?: { client?: { name: string } } };
        }>) {
          const nm = sq?.scope?.brief?.client?.name;
          if (!nm) continue;
          const pr = (schedProjRows ?? []).find((p) => p.quote_id === sq.id);
          if (pr) schedClientByProject.set(pr.id, nm);
        }
      }

      // Cache per-list field definitions.
      type CuField = {
        id: string;
        name: string;
        type: string;
        type_config?: { options?: Array<{ id: string; name: string }> };
      };
      const fieldsByList = new Map<string, CuField[]>();
      async function getFieldsFor(listId: string): Promise<CuField[]> {
        if (fieldsByList.has(listId)) return fieldsByList.get(listId)!;
        const r = await fetch(
          `https://api.clickup.com/api/v2/list/${listId}/field`,
          CU,
        );
        const fields = r.ok ? ((await r.json()).fields ?? []) : [];
        fieldsByList.set(listId, fields);
        return fields;
      }

      // Service names for task titles.
      const schedServiceIds = [
        ...new Set((dueSchedules as Array<{ service_id: string }>).map((s) => s.service_id)),
      ];
      const { data: schedServices } = await supabase
        .from("services")
        .select("id,name")
        .in("id", schedServiceIds);
      const serviceById = new Map(
        (schedServices ?? []).map((s: { id: string; name: string }) => [s.id, s]),
      );

      for (const s of dueSchedules as Array<{
        id: string;
        project_id: string;
        service_id: string;
        dept_id: string;
        planned_hours: number | string;
        clickup_parent_task_id: string;
        clickup_list_id: string;
        recurrence_interval: Interval;
        next_due_at: string;
      }>) {
        try {
          const project = schedProjMap.get(s.project_id);
          if (!project || project.status !== "in_progress") {
            await supabase
              .from("recurring_task_schedules")
              .update({ status: "completed" })
              .eq("id", s.id);
            continue;
          }
          const dept = deptMap.get(s.dept_id);
          const svc = serviceById.get(s.service_id);
          if (!dept || !svc) continue;
          const owner = dept.primary_team_member_id
            ? teamMap.get(dept.primary_team_member_id)
            : null;
          const clientName = schedClientByProject.get(s.project_id) ?? "Unknown";
          const plannedHours = Number(s.planned_hours);
          const cycleIso = s.next_due_at.slice(0, 10);

          const cuFields = await getFieldsFor(s.clickup_list_id);
          function pickOption(fn: string, opt: string): { id: string; value: string } | null {
            const f = cuFields.find((x) => x.name === fn && x.type === "drop_down");
            if (!f?.type_config?.options) return null;
            const needle = opt.trim().toLowerCase();
            const o = f.type_config.options.find((x) => x.name?.trim().toLowerCase() === needle);
            return o ? { id: f.id, value: o.id } : null;
          }
          const cf: Array<{ id: string; value: string | number }> = [];
          const a = pickOption("Client Name", clientName);
          if (a) cf.push(a);
          const b = pickOption("Engagement Type", "Task");
          if (b) cf.push(b);
          const c = pickOption("Work Stream", dept.name);
          if (c) cf.push(c);
          const dateF = cuFields.find((x) => x.name === "Date of Engagement" && x.type === "date");
          if (dateF) cf.push({ id: dateF.id, value: new Date(s.next_due_at).getTime() });

          const r = await fetch(
            `https://api.clickup.com/api/v2/list/${s.clickup_list_id}/task`,
            {
              ...CU,
              method: "POST",
              body: JSON.stringify({
                name: `${svc.name} — ${dept.name} (${cycleIso})`,
                parent: s.clickup_parent_task_id,
                assignees: owner?.clickup_user_id ? [owner.clickup_user_id] : [],
                time_estimate: Math.round(plannedHours * 60 * 60_000),
                points: Math.min(10, Math.max(1, Math.round(plannedHours / 4))),
                due_date: new Date(s.next_due_at).getTime(),
                due_date_time: false,
                start_date: new Date(s.next_due_at).getTime(),
                start_date_time: false,
                ...(cf.length > 0 && { custom_fields: cf }),
              }),
            },
          );
          if (!r.ok) {
            errors.push(`Schedule ${s.id}: CU task failed — ${await r.text()}`);
            continue;
          }
          const child = await r.json();

          await fetch(`https://api.clickup.com/api/v2/task/${child.id}/comment`, {
            ...CU,
            method: "POST",
            body: JSON.stringify({
              comment_text: buildBriefComment({
                client_name: clientName,
                engagement_type: "Task",
                work_stream: dept.name,
                sprint_points: Math.max(1, Math.round(plannedHours / 4)),
                date_of_engagement: cycleIso,
                source_quote_id: project.quote_id,
              }),
            }),
          });

          await supabase.from("project_actuals").insert({
            project_id: s.project_id,
            clickup_task_id: child.id,
            dept_id: s.dept_id,
            planned_hours: plannedHours,
          });

          const nextDue = advanceDate(new Date(s.next_due_at), s.recurrence_interval);
          await supabase
            .from("recurring_task_schedules")
            .update({
              next_due_at: nextDue.toISOString(),
              last_created_at: new Date().toISOString(),
            })
            .eq("id", s.id);

          createdTotal++;
        } catch (e) {
          errors.push(
            `Schedule ${s.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    return json({
      created: createdTotal,
      projects_processed: active.length,
      schedules_processed: dueSchedules?.length ?? 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
