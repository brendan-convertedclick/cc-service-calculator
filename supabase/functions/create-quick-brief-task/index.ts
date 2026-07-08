// supabase/functions/create-quick-brief-task/index.ts
//
// Request:  POST { brief_id, task_name, assignee_member_id?, sprint_points,
//                  work_stream, due_date? }
// Response: 200 { clickup_task_id, clickup_task_url }
//
// Turns a brief into ONE ClickUp task with no scope/SOW/quote. Idempotent:
// if the brief already has a clickup_task_id, returns it unchanged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { buildBriefComment, buildBriefTaskBody } from "../_shared/clickup.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const b = (await req.json()) as {
      brief_id?: string; task_name?: string; assignee_member_id?: string | null;
      sprint_points?: number; work_stream?: string; due_date?: string | null;
    };
    if (!b.brief_id || !b.task_name || !b.work_stream || !b.sprint_points) {
      return json({ error: "brief_id, task_name, work_stream, sprint_points required" }, 400);
    }
    const sb = createServiceRoleClient();
    const clickupPat = Deno.env.get("CLICKUP_PAT");
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select("id, raw_subject, raw_body, status, clickup_task_id, clickup_task_url, client:clients(id, name, clickup_folder_id)")
      .eq("id", b.brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    // Idempotency
    if (brief.clickup_task_id) {
      return json({ clickup_task_id: brief.clickup_task_id, clickup_task_url: brief.clickup_task_url, already_briefed: true });
    }

    const client = (brief as unknown as { client?: { id: string; name: string; clickup_folder_id: string | null } | null }).client;
    if (!client) return json({ error: "Brief has no client — assign a client first." }, 400);
    if (!client.clickup_folder_id) return json({ error: `Client ${client.name} has no ClickUp folder configured.` }, 400);

    // Resolve the target list: the "projects" list in the client's folder, else the first list.
    const listsRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      { headers: { Authorization: clickupPat, "Content-Type": "application/json" } },
    );
    if (!listsRes.ok) return json({ error: `ClickUp lists ${listsRes.status}: ${await listsRes.text()}` }, 502);
    const lists = ((await listsRes.json()).lists ?? []) as Array<{ id: string; name: string }>;
    if (lists.length === 0) return json({ error: `Client ${client.name} folder has no lists.` }, 400);
    const list = lists.find((l) => /project/i.test(l.name)) ?? lists[0];

    // Resolve assignee → clickup_user_id.
    let assigneeClickupId: number | null = null;
    if (b.assignee_member_id) {
      const { data: m } = await sb.from("team_members").select("clickup_user_id").eq("id", b.assignee_member_id).maybeSingle();
      assigneeClickupId = (m as { clickup_user_id: number | null } | null)?.clickup_user_id ?? null;
    }

    // Custom field defs for the list.
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };
    const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/field`, CU);
    if (!fieldsRes.ok) return json({ error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` }, 502);
    const cuFields = ((await fieldsRes.json()).fields ?? []) as Array<{ id: string; name: string; type: string }>;

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const dueDateMs = b.due_date ? Date.parse(b.due_date) : null;
    const description =
      `${b.task_name}\n\n${brief.raw_body ?? ""}\n\n---\n` +
      `_Quick-briefed from inbox brief ${brief.id} on ${dateOfEngagement}._`;

    const taskBody = buildBriefTaskBody(cuFields, {
      name: b.task_name, description,
      clientName: client.name, workStream: b.work_stream, engagementType: "Task",
      sprintPoints: b.sprint_points, dateOfEngagement, assigneeClickupId, dueDateMs,
    });

    const createRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/task`, {
      ...CU, method: "POST", body: JSON.stringify(taskBody),
    });
    if (!createRes.ok) return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
    const created = (await createRes.json()) as { id: string; url: string };

    const comment = buildBriefComment({
      client_name: client.name, engagement_type: "Task", work_stream: b.work_stream,
      sprint_points: b.sprint_points, date_of_engagement: dateOfEngagement,
      source_quote_id: `quick_brief:${brief.id}`,
    });
    // Fire-and-forget: the task already exists, so a failed audit comment must
    // not fail the request. Log it so it can be reconciled by hand.
    const commentRes = await fetch(`https://api.clickup.com/api/v2/task/${created.id}/comment`, {
      ...CU, method: "POST", body: JSON.stringify({ comment_text: comment, notify_all: false }),
    });
    if (!commentRes.ok) {
      console.error(`[create-quick-brief-task] BRIEF:: comment failed for task ${created.id}: ${commentRes.status} ${await commentRes.text()}`);
    }

    const { error: upErr } = await sb.from("briefs").update({
      status: "briefed", clickup_task_id: created.id, clickup_task_url: created.url,
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);
    if (upErr) {
      // ORPHANED TASK: the ClickUp task exists but the brief wasn't marked
      // briefed, so the idempotency guard (which keys on clickup_task_id) won't
      // fire on retry. Surface a distinctly-worded, non-retryable error and log
      // it so an operator reconciles by hand instead of blind-retrying into a
      // duplicate ClickUp task.
      console.error(`[create-quick-brief-task] ORPHANED TASK ${created.id} (${created.url}) for brief ${brief.id}: DB update failed: ${upErr.message}`);
      return json({
        error: `Task ${created.id} was created in ClickUp but the brief could not be marked briefed — reconcile manually, do not retry. (${upErr.message})`,
        clickup_task_id: created.id, clickup_task_url: created.url, orphaned: true,
      }, 500);
    }
    return json({ clickup_task_id: created.id, clickup_task_url: created.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
