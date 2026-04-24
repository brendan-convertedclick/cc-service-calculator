// supabase/functions/create-recurring-tasks/index.ts
//
// Cron-triggered function that creates ClickUp child tasks for recurring
// service allocations. Runs daily (or on-demand via POST).
//
// For each active schedule where next_due_at <= now and the parent project
// is still in_progress:
//   1. Look up department owner → clickup_user_id for assignee.
//   2. Fetch ClickUp custom field definitions from the target list.
//   3. Create a child task under the parent task.
//   4. Insert a project_actuals row.
//   5. Advance next_due_at by one interval.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { buildBriefComment } from "../_shared/clickup.ts";
import { advanceDate } from "../_shared/recurrence.ts";

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

    // Find all due schedules with their related data via nested selects.
    const now = new Date().toISOString();
    const { data: schedules, error: schedErr } = await supabase
      .from("recurring_task_schedules")
      .select("*")
      .eq("status", "active")
      .lte("next_due_at", now);
    if (schedErr) return json({ error: schedErr.message }, 500);
    if (!schedules?.length) return json({ created: 0 });

    // Collect IDs we need to look up.
    const projectIds = [...new Set(schedules.map((s) => s.project_id))];
    const serviceIds = [...new Set(schedules.map((s) => s.service_id))];
    const deptIds = [...new Set(schedules.map((s) => s.dept_id))];

    // Fetch related data in parallel.
    const [projectsRes, servicesRes, deptsRes, teamRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id,status,quote_id,clickup_parent_task_id")
        .in("id", projectIds),
      supabase.from("services").select("id,name").in("id", serviceIds),
      supabase
        .from("departments")
        .select("id,name,primary_team_member_id")
        .in("id", deptIds),
      supabase
        .from("team_members")
        .select("id,clickup_user_id")
        .is("archived_at", null),
    ]);

    const projectMap = new Map(
      (projectsRes.data ?? []).map((p) => [p.id, p]),
    );
    const serviceMap = new Map(
      (servicesRes.data ?? []).map((s) => [s.id, s]),
    );
    const deptMap = new Map(
      (deptsRes.data ?? []).map((d) => [d.id, d]),
    );
    const teamMap = new Map(
      (teamRes.data ?? []).map((t) => [t.id, t]),
    );

    // Resolve client name for custom fields via project → quote → scope → brief → client.
    const quoteIds = [
      ...new Set(
        (projectsRes.data ?? [])
          .map((p) => p.quote_id)
          .filter(Boolean),
      ),
    ];
    let clientByProject = new Map<string, { name: string }>();
    if (quoteIds.length > 0) {
      const { data: quotes } = await supabase
        .from("quotes")
        .select("id,scope:scopes(brief:briefs(client:clients(name)))")
        .in("id", quoteIds);
      for (const q of quotes ?? []) {
        const clientName = (q as { scope?: { brief?: { client?: { name: string } } } })
          ?.scope?.brief?.client?.name;
        if (clientName) {
          const proj = (projectsRes.data ?? []).find((p) => p.quote_id === q.id);
          if (proj) clientByProject.set(proj.id, { name: clientName });
        }
      }
    }

    const CU = {
      headers: {
        Authorization: clickupPat,
        "Content-Type": "application/json",
      },
    };

    // Cache custom field definitions per list to avoid redundant fetches.
    type CuField = {
      id: string;
      name: string;
      type: string;
      type_config?: { options?: Array<{ id: string; name: string }> };
    };
    const fieldsByList = new Map<string, CuField[]>();
    async function getFields(listId: string): Promise<CuField[]> {
      if (fieldsByList.has(listId)) return fieldsByList.get(listId)!;
      const res = await fetch(
        `https://api.clickup.com/api/v2/list/${listId}/field`,
        CU,
      );
      const fields = res.ok ? ((await res.json()).fields ?? []) : [];
      fieldsByList.set(listId, fields);
      return fields;
    }

    function resolveDropdownOption(
      fields: CuField[],
      fieldName: string,
      optionName: string,
    ): { id: string; value: string } | null {
      const field = fields.find(
        (f) => f.name === fieldName && f.type === "drop_down",
      );
      if (!field?.type_config?.options) return null;
      const needle = optionName.trim().toLowerCase();
      const option = field.type_config.options.find(
        (o) => o.name?.trim().toLowerCase() === needle,
      );
      return option ? { id: field.id, value: option.id } : null;
    }

    let created = 0;
    const errors: string[] = [];

    for (const schedule of schedules) {
      const project = projectMap.get(schedule.project_id);
      if (!project || project.status !== "in_progress") {
        // Project is done — mark schedule as completed.
        await supabase
          .from("recurring_task_schedules")
          .update({ status: "completed" })
          .eq("id", schedule.id);
        continue;
      }

      const service = serviceMap.get(schedule.service_id);
      const dept = deptMap.get(schedule.dept_id);
      if (!service || !dept) continue;

      const owner = dept.primary_team_member_id
        ? teamMap.get(dept.primary_team_member_id)
        : null;
      const client = clientByProject.get(schedule.project_id);

      try {
        const cuFields = await getFields(schedule.clickup_list_id);

        const taskCf: Array<{ id: string; value: string | number }> = [];
        if (client) {
          const cf = resolveDropdownOption(cuFields, "Client Name", client.name);
          if (cf) taskCf.push(cf);
        }
        const engCf = resolveDropdownOption(cuFields, "Engagement Type", "Task");
        if (engCf) taskCf.push(engCf);
        const wsCf = resolveDropdownOption(cuFields, "Work Stream", dept.name);
        if (wsCf) taskCf.push(wsCf);
        const dateField = cuFields.find(
          (f) => f.name === "Date of Engagement" && f.type === "date",
        );
        if (dateField) taskCf.push({ id: dateField.id, value: Date.now() });

        const dueDateMs = new Date(schedule.next_due_at).getTime();

        const childRes = await fetch(
          `https://api.clickup.com/api/v2/list/${schedule.clickup_list_id}/task`,
          {
            ...CU,
            method: "POST",
            body: JSON.stringify({
              name: `${service.name} — ${dept.name}`,
              parent: schedule.clickup_parent_task_id,
              assignees: owner?.clickup_user_id ? [owner.clickup_user_id] : [],
              time_estimate: Math.round(Number(schedule.planned_hours) * 60 * 60_000),
              points: Math.min(
                10,
                Math.max(1, Math.round(Number(schedule.planned_hours) / 4)),
              ),
              due_date: dueDateMs,
              due_date_time: false,
              start_date: Date.now(),
              start_date_time: false,
              ...(taskCf.length > 0 && { custom_fields: taskCf }),
            }),
          },
        );

        if (!childRes.ok) {
          errors.push(
            `Schedule ${schedule.id}: CU task failed — ${await childRes.text()}`,
          );
          continue;
        }
        const child = await childRes.json();

        // Post BRIEF:: comment.
        await fetch(`https://api.clickup.com/api/v2/task/${child.id}/comment`, {
          ...CU,
          method: "POST",
          body: JSON.stringify({
            comment_text: buildBriefComment({
              client_name: client?.name ?? "Unknown",
              engagement_type: "Task",
              work_stream: dept.name,
              sprint_points: Math.max(
                1,
                Math.round(Number(schedule.planned_hours) / 4),
              ),
              date_of_engagement: new Date().toISOString().slice(0, 10),
              source_quote_id: project.quote_id,
            }),
          }),
        });

        // Insert project_actuals row.
        await supabase.from("project_actuals").insert({
          project_id: schedule.project_id,
          clickup_task_id: child.id,
          dept_id: schedule.dept_id,
          planned_hours: Number(schedule.planned_hours),
        });

        // Advance next_due_at.
        const nextDue = advanceDate(
          new Date(schedule.next_due_at),
          schedule.recurrence_interval as
            | "weekly"
            | "biweekly"
            | "monthly"
            | "quarterly",
        );
        await supabase
          .from("recurring_task_schedules")
          .update({
            next_due_at: nextDue.toISOString(),
            last_created_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        created++;
      } catch (e) {
        errors.push(
          `Schedule ${schedule.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return json({ created, errors: errors.length > 0 ? errors : undefined });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
