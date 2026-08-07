// supabase/functions/create-adhoc-project/index.ts
//
// Request:  POST {
//   client_id:    string,
//   project_name: string,
//   tasks: Array<{
//     task_name:           string,
//     assignee_member_id?: string | null,
//     sprint_points:       number,
//     work_stream:         string,
//     status?:             string,
//     due_date?:           string | null,
//   }>
// }
// Response: 200 {
//   project_id, clickup_list_id, clickup_parent_task_id,
//   created_task_ids: string[], task_failures?: [{task_name, error}]
// } | 400/404/500/502 { error }
//
// Creates a NON-recurring "project" for a client with multiple ad-hoc tasks.
// Orchestration mirrors create-retainer + create-client-list + create-quick-
// brief-task:
//   1. Validate + load the client (must have a ClickUp folder).
//   2. Create a NEW ClickUp list in the client's folder (named project_name) and
//      insert a client_lists row (orphan-on-DB-failure like create-client-list).
//   3. Create a parent umbrella task in the new list (status omitted → CRTSK_001).
//   4. Insert the projects row (engagement_type='fixed', is_recurring=false,
//      recurrence_mode='none' so no cron recurs it). On failure → delete parent
//      task + best-effort delete the list.
//   5. Fetch the new list's custom fields once.
//   6. Per task: buildBriefTaskBody + parent + optional status → POST → points-cap
//      retry → BRIEF:: comment (fire-and-forget) → project_actuals row. A per-task
//      failure is collected into task_failures; the project + other tasks stand.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { buildBriefComment, buildBriefTaskBody, type CuField } from "../_shared/clickup.ts";
import {
  CLICKUP_WORKSPACE_ID,
  isMeetingWorkStream,
  mentionToken,
  MEETINGS_CHANNEL_ID,
  NEW_TASKS_CHANNEL_ID,
  postChatMessage,
} from "../_shared/clickup-chat.ts";

const POINT_TO_MIN = 15;

type TaskInput = {
  task_name?: string;
  assignee_member_id?: string | null;
  sprint_points?: number;
  work_stream?: string;
  status?: string;
  due_date?: string | null;
};

type AdhocBody = {
  client_id?: string;
  project_name?: string;
  tasks?: TaskInput[];
};

type CuList = { id: string; name: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as AdhocBody;
    const { client_id, project_name, tasks } = body;

    // --- Validation (400) ---
    if (!client_id) return json({ error: "client_id required" }, 400);
    if (!project_name || typeof project_name !== "string" || project_name.trim().length === 0) {
      return json({ error: "project_name required" }, 400);
    }
    if (!Array.isArray(tasks) || tasks.length < 1) {
      return json({ error: "At least one task is required" }, 400);
    }
    for (const [i, t] of tasks.entries()) {
      if (!t.task_name || typeof t.task_name !== "string" || t.task_name.trim().length === 0) {
        return json({ error: `tasks[${i}]: task_name required` }, 400);
      }
      if (typeof t.sprint_points !== "number" || !(t.sprint_points > 0)) {
        return json({ error: `tasks[${i}]: sprint_points must be > 0` }, 400);
      }
      if (!t.work_stream || typeof t.work_stream !== "string" || t.work_stream.trim().length === 0) {
        return json({ error: `tasks[${i}]: work_stream required` }, 400);
      }
    }

    const sb = createServiceRoleClient();
    const { token: clickupPat, via } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };

    // --- Step 1: load the client (must have a ClickUp folder) ---
    const { data: client, error: cErr } = await sb
      .from("clients")
      .select("id, name, clickup_client_name, clickup_folder_id")
      .eq("id", client_id)
      .single();
    if (cErr || !client) return json({ error: cErr?.message ?? "Client not found" }, 404);
    if (!client.clickup_folder_id) {
      return json({ error: `Client ${client.name} has no clickup_folder_id` }, 400);
    }

    const listName = project_name.trim();

    // --- Step 2: create the new ClickUp list in the client's folder ---
    const listRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      { ...CU, method: "POST", body: JSON.stringify({ name: listName }) },
    );
    if (!listRes.ok) {
      return json({ error: `CU list create failed: ${await listRes.text()}` }, 502);
    }
    const cuList = (await listRes.json()) as CuList;
    if (!cuList?.id) {
      return json({ error: `CU list create returned no id: ${JSON.stringify(cuList)}` }, 502);
    }
    const newListId = cuList.id;

    // Insert the client_lists row (mirror create-client-list's custom-list shape:
    // group_id null, custom_label = the list name). On DB failure surface the
    // orphaned ClickUp list id instead of blind-retrying into a duplicate list.
    const { error: clErr } = await sb
      .from("client_lists")
      .insert({
        client_id,
        group_id: null,
        clickup_list_id: newListId,
        clickup_list_name: cuList.name,
        custom_label: listName,
      });
    if (clErr) {
      return json(
        { error: clErr.message, orphan_clickup_list_id: newListId },
        500,
      );
    }

    // --- Step 3: create the parent umbrella task (omit status → CRTSK_001) ---
    const parentTaskId = await createClickupTask(clickupPat, newListId, {
      name: `[Project] ${client.name} — ${listName}`,
      description: `Umbrella task for ad-hoc project "${listName}" (${client.name}).`,
    });
    if (!parentTaskId) {
      // Best-effort delete the orphaned list before surfacing the failure.
      await deleteClickupList(clickupPat, newListId);
      // Also remove the client_lists row we inserted in step 2 — otherwise it
      // survives pointing at a now-deleted list, and other jobs (provision-
      // ongoing-tasks, sync-client-clickup-structure, create-retainer) that
      // read client_lists would 404 against ClickUp indefinitely. Best-effort:
      // log and continue so a delete failure doesn't mask the original error.
      const { error: clDelErr } = await sb
        .from("client_lists")
        .delete()
        .eq("clickup_list_id", newListId);
      if (clDelErr) {
        console.error(
          `[create-adhoc-project] client_lists cleanup failed for list ${newListId}: ${clDelErr.message}`,
        );
      }
      return json({ error: "Failed to create ClickUp project parent task." }, 502);
    }

    // --- Step 4: insert the projects row ---
    // engagement_type='fixed' (projects.engagement_type CHECK allows only
    // 'fixed'|'retainer'; an adhoc project is a fixed-scope, non-recurring one)
    // + is_recurring=false + recurrence_mode='none'
    // keeps this out of both create-recurring-tasks and provision-retainer-period.
    // project_code is stamped by the DB before-insert trigger (see 0024) — omit
    // it, exactly like create-retainer.
    const { data: project, error: pErr } = await sb
      .from("projects")
      .insert({
        name: listName,
        client_id,
        engagement_type: "fixed",
        is_recurring: false,
        recurrence_mode: "none",
        recurrence_interval: null,
        status: "in_progress",
        clickup_list_id: newListId,
        clickup_parent_task_id: parentTaskId,
        due_date: null,
      })
      .select("id")
      .single();
    if (pErr || !project) {
      // Cleanup: delete the parent task + best-effort delete the list.
      await deleteClickupTask(clickupPat, parentTaskId);
      await deleteClickupList(clickupPat, newListId);
      // Also remove the client_lists row we inserted in step 2 — otherwise it
      // survives pointing at a now-deleted list, and other jobs (provision-
      // ongoing-tasks, sync-client-clickup-structure, create-retainer) that
      // read client_lists would 404 against ClickUp indefinitely. Best-effort:
      // log and continue so a delete failure doesn't mask the original error.
      const { error: clDelErr } = await sb
        .from("client_lists")
        .delete()
        .eq("clickup_list_id", newListId);
      if (clDelErr) {
        console.error(
          `[create-adhoc-project] client_lists cleanup failed for list ${newListId}: ${clDelErr.message}`,
        );
      }
      return json({ error: pErr?.message ?? "Failed to insert project" }, 500);
    }
    const projectId = project.id as string;

    // --- Step 5: fetch the new list's custom field defs once ---
    const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${newListId}/field`, CU);
    const cuFields = (fieldsRes.ok ? ((await fieldsRes.json()).fields ?? []) : []) as CuField[];

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const clientName = client.clickup_client_name ?? client.name;

    // Preload assignee → clickup_user_id for the tasks that request one.
    const memberIds = [
      ...new Set(
        tasks.map((t) => t.assignee_member_id).filter((v): v is string => !!v),
      ),
    ];
    const memberClickupById = new Map<string, number | null>();
    const memberNameById = new Map<string, string>();
    if (memberIds.length > 0) {
      const { data: members } = await sb
        .from("team_members")
        .select("id, clickup_user_id, full_name")
        .in("id", memberIds);
      for (const m of (members ?? []) as Array<{ id: string; clickup_user_id: number | null; full_name: string | null }>) {
        memberClickupById.set(m.id, m.clickup_user_id ?? null);
        if (m.full_name) memberNameById.set(m.id, m.full_name);
      }
    }

    // --- Step 6: create one child task per row ---
    const created_task_ids: string[] = [];
    const task_failures: Array<{ task_name: string; error: string }> = [];
    const chatLines: Array<{ line: string; workStream: string }> = [];

    for (const t of tasks) {
      const taskName = t.task_name!.trim();
      try {
        const assigneeClickupId = t.assignee_member_id
          ? memberClickupById.get(t.assignee_member_id) ?? null
          : null;
        const dueDateMs = t.due_date ? Date.parse(t.due_date) : null;

        const taskBody = buildBriefTaskBody(cuFields, {
          name: taskName,
          description: taskName,
          clientName,
          workStream: t.work_stream!,
          engagementType: "Task",
          sprintPoints: t.sprint_points!,
          dateOfEngagement,
          assigneeClickupId,
          dueDateMs: dueDateMs && !Number.isNaN(dueDateMs) ? dueDateMs : null,
        });
        // Parent the task under the umbrella task in the new list.
        taskBody.parent = parentTaskId;
        // The list is always the freshly-created one, so a status the caller
        // offered from the space is valid here — set it only when provided.
        if (t.status) taskBody.status = t.status;

        const taskUrl = `https://api.clickup.com/api/v2/list/${newListId}/task`;
        let createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
        // ClickUp rejects very large sprint-point values on create; retry once
        // without `points` (time_estimate still carries the effort).
        if (!createRes.ok && "points" in taskBody) {
          const errText = await createRes.text();
          console.warn(
            `[create-adhoc-project] create failed with points (${createRes.status}: ${errText}); retrying without points`,
          );
          const { points: _dropped, ...noPoints } = taskBody;
          createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
        }
        if (!createRes.ok) {
          task_failures.push({ task_name: taskName, error: `ClickUp create ${createRes.status}: ${await createRes.text()}` });
          continue;
        }
        const createdTask = (await createRes.json()) as { id: string };

        // BRIEF:: audit comment — fire-and-forget (task already exists).
        try {
          const comment = buildBriefComment({
            client_name: client.name,
            engagement_type: "Task",
            work_stream: t.work_stream!,
            sprint_points: t.sprint_points!,
            date_of_engagement: dateOfEngagement,
            source_quote_id: `adhoc_project:${projectId}`,
          });
          const commentRes = await fetch(
            `https://api.clickup.com/api/v2/task/${createdTask.id}/comment`,
            { ...CU, method: "POST", body: JSON.stringify({ comment_text: comment, notify_all: false }) },
          );
          if (!commentRes.ok) {
            console.error(
              `[create-adhoc-project] BRIEF:: comment failed for task ${createdTask.id}: ${commentRes.status} ${await commentRes.text()}`,
            );
          }
        } catch (ce) {
          console.error(
            `[create-adhoc-project] BRIEF:: comment threw for task ${createdTask.id}: ${ce instanceof Error ? ce.message : String(ce)}`,
          );
        }

        // Record a project_actuals row (planned_hours from sprint points).
        const { error: paErr } = await sb.from("project_actuals").insert({
          project_id: projectId,
          clickup_task_id: createdTask.id,
          task_name: taskName,
          planned_hours: (t.sprint_points! * POINT_TO_MIN) / 60,
          dept_id: null,
        });
        if (paErr) {
          console.error(
            `[create-adhoc-project] project_actuals insert failed for task ${createdTask.id}: ${paErr.message}`,
          );
        }

        created_task_ids.push(createdTask.id);

        const mention = mentionToken({
          clickupUserId: assigneeClickupId,
          name: t.assignee_member_id ? memberNameById.get(t.assignee_member_id) ?? null : null,
        });
        chatLines.push({
          line: `• ${mention} — ${taskName} · ${t.sprint_points} pt · https://app.clickup.com/t/${createdTask.id}`,
          workStream: t.work_stream!,
        });
      } catch (te) {
        task_failures.push({ task_name: taskName, error: te instanceof Error ? te.message : String(te) });
      }
    }

    // Notify the workspace-wide channels that the project + its tasks exist —
    // mirrors create-quick-brief-task. Best-effort: everything is already
    // created, so a failed post must never fail the request — log and move
    // on. Global channels, not the client's own (2026-08-06) — client
    // channels stay human-only; clients aren't members of either one.
    // Meeting-work-stream tasks (Internal Meeting / Client Meeting) go to
    // Meetings, everything else to New Tasks — a batch can contain both.
    const notifyGroup = async (channelId: string, lines: typeof chatLines) => {
      if (lines.length === 0) return;
      const listUrl = `https://app.clickup.com/${CLICKUP_WORKSPACE_ID}/v/li/${newListId}`;
      const content =
        `🆕 New project briefed: **${listName}** (${client.name}) · ` +
        `${lines.length} task${lines.length !== 1 ? "s" : ""} · ${listUrl}\n` +
        lines.map((l) => l.line).join("\n");
      const chatRes = await postChatMessage(clickupPat, channelId, content);
      if (!chatRes.ok) {
        console.error(
          `[create-adhoc-project] chat notify failed for project ${projectId} (channel ${channelId}): ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
      }
    };
    if (created_task_ids.length > 0) {
      const meetingLines = chatLines.filter((l) => isMeetingWorkStream(l.workStream));
      const taskLines = chatLines.filter((l) => !isMeetingWorkStream(l.workStream));
      await notifyGroup(NEW_TASKS_CHANNEL_ID, taskLines);
      await notifyGroup(MEETINGS_CHANNEL_ID, meetingLines);
    }

    return json({
      project_id: projectId,
      clickup_list_id: newListId,
      clickup_parent_task_id: parentTaskId,
      created_task_ids,
      via,
      ...(task_failures.length > 0 && { task_failures }),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function createClickupTask(
  pat: string,
  listId: string,
  args: { name: string; description: string },
): Promise<string | null> {
  // Omit `status` — client spaces use custom status sets, so hardcoding a
  // value fails with CRTSK_001. Let ClickUp use the list default.
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify({ name: args.name, description: args.description }),
  });
  if (!res.ok) return null;
  const r = (await res.json()) as { id: string };
  return r.id;
}

async function deleteClickupTask(pat: string, taskId: string): Promise<void> {
  try {
    await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: pat, "Content-Type": "application/json" },
    });
  } catch {
    // Best-effort cleanup — ignore failures.
  }
}

async function deleteClickupList(pat: string, listId: string): Promise<void> {
  try {
    await fetch(`https://api.clickup.com/api/v2/list/${listId}`, {
      method: "DELETE",
      headers: { Authorization: pat, "Content-Type": "application/json" },
    });
  } catch {
    // Best-effort cleanup — ignore failures.
  }
}
