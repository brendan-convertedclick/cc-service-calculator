// supabase/functions/create-quick-brief-task/index.ts
//
// Request:  POST { brief_id, task_name, assignee_member_id?, sprint_points,
//                  work_stream, due_date?, list_id?, status?, system_id? }
// Response: 200 { clickup_task_id, clickup_task_url }
//
// Turns a brief into ONE ClickUp task with no scope/SOW/quote. Idempotent:
// if the brief already has a clickup_task_id, returns it unchanged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { addClickupChecklist, buildBriefComment, buildBriefTaskBody, type CuField } from "../_shared/clickup.ts";
import { briefBriefedMessage, isMeetingWorkStream, mentionToken, MEETINGS_CHANNEL_ID, NEW_TASKS_CHANNEL_ID, postChatMessage } from "../_shared/clickup-chat.ts";
import { renderDocLinks } from "../_shared/system-materialise.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    type Body = {
      brief_id?: string; task_name?: string; description?: string;
      assignee_member_id?: string | null;
      sprint_points?: number; work_stream?: string; due_date?: string | null;
      list_id?: string; status?: string; briefed_by_member_id?: string | null;
      billing_type?: string; checklist_items?: string[];
      system_id?: string | null;
    };
    // File attachments arrive as multipart/form-data (payload = JSON string,
    // one or more "file" entries); no attachments → plain JSON, as before.
    let b: Body;
    let attachmentFiles: File[] = [];
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      b = JSON.parse((form.get("payload") as string) ?? "{}") as Body;
      attachmentFiles = form.getAll("file").filter((f): f is File => f instanceof File);
    } else {
      b = (await req.json()) as Body;
    }
    if (!b.brief_id || !b.task_name || !b.work_stream || !b.sprint_points) {
      return json({ error: "brief_id, task_name, work_stream, sprint_points required" }, 400);
    }
    const sb = createServiceRoleClient();
    const { token: clickupPat, via } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select("id, raw_subject, raw_body, status, clickup_task_id, clickup_task_url, client:clients(id, name, clickup_client_name, clickup_folder_id)")
      .eq("id", b.brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    // Idempotency
    if (brief.clickup_task_id) {
      return json({ clickup_task_id: brief.clickup_task_id, clickup_task_url: brief.clickup_task_url, already_briefed: true });
    }

    const client = (brief as unknown as { client?: { id: string; name: string; clickup_client_name: string | null; clickup_folder_id: string | null } | null }).client;
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
    // Prefer an explicit list_id if it belongs to this folder's lists; otherwise
    // fall back to the existing auto-pick (a "projects" list, else the first).
    const requestedList = b.list_id ? lists.find((l) => l.id === b.list_id) : undefined;
    const list = requestedList ?? lists.find((l) => /project/i.test(l.name)) ?? lists[0];

    // Resolve assignee → clickup_user_id (+ name for the audit note).
    let assigneeClickupId: number | null = null;
    let assigneeName: string | null = null;
    let assigneeEmail: string | null = null;
    if (b.assignee_member_id) {
      const { data: m } = await sb
        .from("team_members")
        .select("clickup_user_id, full_name, email")
        .eq("id", b.assignee_member_id)
        .maybeSingle();
      const member = m as { clickup_user_id: number | null; full_name: string | null; email: string | null } | null;
      assigneeClickupId = member?.clickup_user_id ?? null;
      assigneeName = member?.full_name ?? null;
      assigneeEmail = member?.email ?? null;
    }

    // Resolve who is briefing. Interim attribution: ClickUp's native "assigned
    // by" is always the shared token owner, so we stamp the real briefer into
    // the task description + audit note until per-user ClickUp auth exists.
    let briefedByName: string | null = null;
    if (b.briefed_by_member_id) {
      const { data: bm } = await sb
        .from("team_members")
        .select("full_name")
        .eq("id", b.briefed_by_member_id)
        .maybeSingle();
      briefedByName = (bm as { full_name: string | null } | null)?.full_name ?? null;
    }

    // Custom field defs for the list.
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };
    const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/field`, CU);
    if (!fieldsRes.ok) return json({ error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` }, 502);
    const cuFields = ((await fieldsRes.json()).fields ?? []) as CuField[];

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const dueDateMs = b.due_date ? Date.parse(b.due_date) : null;
    // Operator-supplied description wins; fall back to task name + brief body.
    const descriptionBody =
      b.description?.trim() || `${b.task_name}\n\n${brief.raw_body ?? ""}`;
    // The picked system's reference documents (0129). QuickBriefSheet resolves
    // the system's steps into checklist text client-side, so the id has to be
    // sent alongside it — the checklist text alone can't say where it came
    // from. Any kind qualifies, which is how a kind='process' system's docs
    // reach ClickUp at all. Best-effort: never fail a task over a doc list.
    let docLinks: string[] = [];
    if (b.system_id) {
      const { data: sys, error: sysErr } = await sb
        .from("system_definitions")
        .select("doc_links")
        .eq("id", b.system_id)
        .maybeSingle();
      if (sysErr) {
        console.error(`[create-quick-brief-task] doc_links lookup failed for system ${b.system_id}: ${sysErr.message}`);
      } else {
        docLinks = ((sys as { doc_links: string[] | null } | null)?.doc_links) ?? [];
      }
    }
    const docsSection = renderDocLinks(docLinks);
    // Conductor is the origin of every task, so the audit line is a clickable
    // link back to the brief rather than a bare uuid nobody can act on.
    const description =
      `${descriptionBody}\n\n` +
      (docsSection ? `${docsSection}\n\n` : "") +
      `---\n` +
      `_Quick-briefed from [Conductor brief](https://conductor.convertedclick.co.za/briefs/view/${brief.id})` +
      ` on ${dateOfEngagement}${briefedByName ? ` by ${briefedByName}` : ""}._`;

    const taskBody = buildBriefTaskBody(cuFields, {
      name: b.task_name, description,
      clientName: client.clickup_client_name ?? client.name, workStream: b.work_stream, engagementType: "Task",
      sprintPoints: b.sprint_points, dateOfEngagement, assigneeClickupId, dueDateMs,
    });
    // buildBriefTaskBody deliberately omits status (avoids CRTSK_001 on the
    // default list status). Only set it when the caller passed a valid status
    // name AND the client's requested list was actually honored — a status
    // scoped to a different (fallback) list may not exist there and would
    // error the create call.
    if (b.status && requestedList) {
      taskBody.status = b.status;
    }

    const taskUrl = `https://api.clickup.com/api/v2/list/${list.id}/task`;
    let createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
    // ClickUp rejects very large sprint-point values on create; retry once
    // without `points` rather than fail the task (time_estimate still carries
    // the effort). See project note on the ClickUp points cap.
    if (!createRes.ok && "points" in taskBody) {
      const errText = await createRes.text();
      console.warn(`[create-quick-brief-task] create failed with points (${createRes.status}: ${errText}); retrying without points`);
      const { points: _dropped, ...noPoints } = taskBody;
      createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
    }
    if (!createRes.ok) return json({ error: `ClickUp create ${createRes.status}: ${await createRes.text()}` }, 502);
    const created = (await createRes.json()) as { id: string; url: string };

    if ((b.checklist_items ?? []).some((c) => c && c.trim())) {
      await addClickupChecklist(clickupPat, created.id, b.checklist_items ?? [], assigneeClickupId);
    }

    // Best-effort per file: the task already exists, so a failed upload must
    // not fail the request — log it so it can be attached manually. ClickUp's
    // attachment endpoint takes one file per call, so upload each in turn.
    for (const file of attachmentFiles) {
      const attachForm = new FormData();
      attachForm.append("attachment", file, file.name);
      const attachRes = await fetch(`https://api.clickup.com/api/v2/task/${created.id}/attachment`, {
        method: "POST",
        headers: { Authorization: clickupPat },
        body: attachForm,
      });
      if (!attachRes.ok) {
        console.error(`[create-quick-brief-task] attachment upload failed for task ${created.id} (${file.name}): ${attachRes.status} ${await attachRes.text()}`);
      }
    }

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
      billing_type: b.billing_type === "adhoc" ? "adhoc" : "retainer",
      // Mirror the task's assignee onto the brief so the drawer/list don't
      // read "Unassigned" for work that was briefed to someone.
      ...(b.assignee_member_id ? { assignee_id: b.assignee_member_id } : {}),
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

    // Notify the workspace-wide New Tasks channel + ping the assignee.
    // Best-effort: the brief is already briefed, so a failed channel post
    // must never fail the request. But a *silently* dropped post is
    // invisible — the task looks briefed yet no one is pinged (see the
    // 2026-07-22 Trellidor miss). So we (1) retry the post a few times to
    // ride out a transient ClickUp hiccup / rate-limit, and (2) if it still
    // fails, drop a visible note on the brief timeline so an operator can
    // re-send instead of never knowing.
    {
      // Global channel, not the client's own (2026-08-06) — client channels
      // stay human-only; clients aren't members of this one. A task briefed
      // under the "Internal Meeting"/"Client Meeting" Work Stream IS a
      // meeting, so route it to the Meetings channel instead of New Tasks.
      const chatChannelId = isMeetingWorkStream(b.work_stream) ? MEETINGS_CHANNEL_ID : NEW_TASKS_CHANNEL_ID;
      const mention = mentionToken({ clickupUserId: assigneeClickupId, name: assigneeName });
      const chatContent = briefBriefedMessage({
        mention,
        taskName: b.task_name,
        points: b.sprint_points,
        taskUrl: created.url,
      });

      // Retry with linear backoff: ClickUp's chat API occasionally 5xx/429s on a
      // single call, and this post runs last in a burst of task-create work, so
      // it's the most likely to get throttled. 3 attempts @ 0/500/1000ms.
      let chatRes = await postChatMessage(clickupPat, chatChannelId, chatContent);
      for (let attempt = 1; attempt < 3 && !chatRes.ok; attempt++) {
        await new Promise((r) => setTimeout(r, attempt * 500));
        console.warn(
          `[create-quick-brief-task] chat notify retry ${attempt} for brief ${brief.id} (channel ${chatChannelId}): prev ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
        chatRes = await postChatMessage(clickupPat, chatChannelId, chatContent);
      }

      if (!chatRes.ok) {
        console.error(
          `[create-quick-brief-task] chat notify FAILED after retries for brief ${brief.id} (channel ${chatChannelId}): ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
        // Surface the miss on the brief timeline so it's not invisible. Best-effort
        // itself — never let this fail the request.
        try {
          await sb.from("brief_messages").insert({
            brief_id: brief.id,
            gmail_message_id: `note-${crypto.randomUUID()}`,
            direction: "note",
            body_text:
              `⚠ Channel notification did not send for this brief (ClickUp chat ${chatRes.status ?? "error"}). ` +
              `The task was created and assigned fine — only the channel ping to ${assigneeName ?? "the team"} failed. Re-send it manually if needed.`,
            relayed_by: "conductor",
            sent_at: new Date().toISOString(),
            to_emails: [],
            cc_emails: [],
          });
        } catch (noteEx) {
          console.error(`[create-quick-brief-task] chat-fail note insert threw for brief ${brief.id}: ${noteEx instanceof Error ? noteEx.message : String(noteEx)}`);
        }
      }
    }

    // In-app audit note: mirrors useAddInternalNote's brief_messages shape so
    // this action shows up in the brief's timeline. Best-effort — the task is
    // already created and the brief already briefed, so a failure here must
    // not fail the request.
    try {
      const summary =
        `Quick task created in ClickUp → ${created.url} · assigned to ${assigneeName ?? "Unassigned"} · ` +
        `${b.sprint_points} pts · ${b.work_stream}${briefedByName ? ` · briefed by ${briefedByName}` : ""}`;
      const { error: noteErr } = await sb.from("brief_messages").insert({
        brief_id: brief.id,
        gmail_message_id: `note-${crypto.randomUUID()}`,
        direction: "note",
        body_text: summary,
        relayed_by: "conductor",
        sent_at: new Date().toISOString(),
        to_emails: [],
        cc_emails: [],
      });
      if (noteErr) {
        console.error(`[create-quick-brief-task] audit note insert failed for brief ${brief.id}: ${noteErr.message}`);
      }
    } catch (noteEx) {
      console.error(`[create-quick-brief-task] audit note insert threw for brief ${brief.id}: ${noteEx instanceof Error ? noteEx.message : String(noteEx)}`);
    }

    return json({ clickup_task_id: created.id, clickup_task_url: created.url, via });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
