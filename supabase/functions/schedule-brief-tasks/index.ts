// supabase/functions/schedule-brief-tasks/index.ts
//
// Request:  POST { brief_id: string, briefed_by_member_id?: string | null,
//                  tasks?: [{ placement_task_id, name?, description?, work_stream?,
//                             points?, assignee_clickup_id?, due_date? }] }
//           `tasks` (when present) is the operator's confirmed selection from
//           Stage 5: only listed placement_tasks are scheduled, and each entry
//           may override the payload defaults (title, description, work
//           stream, sprint points, assignee, due date `YYYY-MM-DD`).
// Response: 200 { created: [{ placement_task_id, clickup_task_id, clickup_task_url, name }],
//                 skipped: number, list_id: string }
//
// Stage 5 of the brief flow ("Approve & Schedule"): once the brief's cost
// estimate is approved, push the per-line team-task breakdown
// (placement_tasks under new-billable placements) to ClickUp — one task per
// placement_task on the client's list. Idempotent: rows that already carry a
// clickup_task_id are skipped, so a partial failure can be re-run safely.
// Marks the brief 'briefed' and drops an audit note in brief_messages.
//
// ClickUp playbook mirrors create-quick-brief-task: folder→list resolution,
// dropdown custom fields resolved to option ids (FIELD_011), status omitted
// (default list status), points-cap retry without `points`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { buildBriefComment, buildBriefTaskBody, type CuField } from "../_shared/clickup.ts";
import {
  CONVERTED_CLICK_CHANNEL_ID,
  mentionToken,
  postChatMessage,
} from "../_shared/clickup-chat.ts";

type PlacementRow = {
  id: string;
  task_ref: string;
  item_name: string | null;
  is_inside: boolean;
  disposition: string | null;
};

type TaskRow = {
  id: string;
  placement_id: string;
  title: string;
  department_id: string | null;
  hours: number | string;
  points: number | string;
  sort_order: number;
  clickup_task_id: string | null;
};

type TaskOverride = {
  placement_task_id: string;
  name?: string;
  description?: string;
  work_stream?: string;
  points?: number;
  assignee_clickup_id?: number | null;
  due_date?: string | null; // YYYY-MM-DD
};

function dueDateToMs(d: string | null | undefined): number | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const b = (await req.json()) as {
      brief_id?: string;
      briefed_by_member_id?: string | null;
      tasks?: TaskOverride[];
      /** Target ClickUp list — chosen in Stage 5. Falls back to the folder heuristic. */
      list_id?: string | null;
      /** Status for created tasks — omitted → list default. */
      status?: string | null;
    };
    if (!b.brief_id) return json({ error: "brief_id required" }, 400);
    const overrides = Array.isArray(b.tasks)
      ? new Map(b.tasks.map((o) => [o.placement_task_id, o]))
      : null;
    if (overrides) {
      const missingDue = [...overrides.values()].filter((o) => dueDateToMs(o.due_date) === null);
      if (missingDue.length > 0) {
        return json(
          { error: `Due date is required on every task (missing on ${missingDue.length}).` },
          400,
        );
      }
    }

    const sb = createServiceRoleClient();
    const { token: clickupPat } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);

    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select(
        "id, raw_subject, status, client:clients(id, name, clickup_client_name, clickup_folder_id, clickup_chat_channel_id)",
      )
      .eq("id", b.brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);

    const client = (brief as unknown as {
      client?: {
        id: string;
        name: string;
        clickup_client_name: string | null;
        clickup_folder_id: string | null;
        clickup_chat_channel_id: string | null;
      } | null;
    }).client;
    if (!client) return json({ error: "Brief has no client — assign a client first." }, 400);
    if (!client.clickup_folder_id) {
      return json({ error: `Client ${client.name} has no ClickUp folder configured.` }, 400);
    }

    // Gate: scheduling requires an approved cost estimate on this brief.
    const { data: ce } = await sb
      .from("change_estimates")
      .select("id, status")
      .eq("brief_id", b.brief_id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ce) return json({ error: "No cost estimate on this brief yet." }, 400);
    if ((ce as { status: string }).status !== "approved") {
      return json({ error: "Cost estimate is not approved yet." }, 400);
    }

    // Billable placements + their team-task breakdown.
    const { data: placementRows, error: pErr } = await sb
      .from("brief_task_sow_placements")
      .select("id, task_ref, item_name, is_inside, disposition")
      .eq("brief_id", b.brief_id);
    if (pErr) return json({ error: pErr.message }, 500);
    const billable = ((placementRows ?? []) as PlacementRow[]).filter((p) =>
      p.disposition ? p.disposition === "new_billable" : !p.is_inside,
    );
    if (billable.length === 0) return json({ error: "No billable placements to schedule." }, 400);
    const placementById = new Map(billable.map((p) => [p.id, p]));

    const { data: taskRows, error: tErr } = await sb
      .from("placement_tasks")
      .select("id, placement_id, title, department_id, hours, points, sort_order, clickup_task_id")
      .in("placement_id", billable.map((p) => p.id))
      .order("sort_order");
    if (tErr) return json({ error: tErr.message }, 500);
    // `overrides` doubles as the confirmed selection: when the caller sends a
    // task list, anything not on it was unticked by the operator and is left
    // unscheduled (already-pushed rows still count as skipped below).
    const tasks = ((taskRows ?? []) as TaskRow[]).filter(
      (t) => t.title.trim() !== "" && (!overrides || overrides.has(t.id) || t.clickup_task_id),
    );
    if (tasks.length === 0) {
      return json({ error: "No team tasks on the billable lines — add them on the scope receipt first." }, 400);
    }

    // Department → ClickUp Work Stream label.
    const { data: depts } = await sb
      .from("departments")
      .select("id, name, clickup_work_stream");
    const workStreamByDept = new Map(
      ((depts ?? []) as Array<{ id: string; name: string; clickup_work_stream: string | null }>)
        .map((d) => [d.id, d.clickup_work_stream ?? d.name]),
    );

    // Who is scheduling (for the description stamp).
    let briefedByName: string | null = null;
    if (b.briefed_by_member_id) {
      const { data: bm } = await sb
        .from("team_members")
        .select("full_name")
        .eq("id", b.briefed_by_member_id)
        .maybeSingle();
      briefedByName = (bm as { full_name: string | null } | null)?.full_name ?? null;
    }

    // Resolve the target list: the operator's Stage-5 choice when given,
    // otherwise fall back to the folder heuristic (prefer a "projects" list).
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };
    const listsRes = await fetch(
      `https://api.clickup.com/api/v2/folder/${client.clickup_folder_id}/list`,
      CU,
    );
    if (!listsRes.ok) return json({ error: `ClickUp lists ${listsRes.status}: ${await listsRes.text()}` }, 502);
    const lists = ((await listsRes.json()).lists ?? []) as Array<{ id: string; name: string }>;
    if (lists.length === 0) return json({ error: `Client ${client.name} folder has no lists.` }, 400);
    const list = (b.list_id && lists.find((l) => l.id === b.list_id)) ??
      lists.find((l) => /project/i.test(l.name)) ??
      lists[0];
    if (b.list_id && list.id !== b.list_id) {
      return json({ error: `List ${b.list_id} is not in ${client.name}'s ClickUp folder.` }, 400);
    }

    const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${list.id}/field`, CU);
    if (!fieldsRes.ok) return json({ error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` }, 502);
    const cuFields = ((await fieldsRes.json()).fields ?? []) as CuField[];

    const dateOfEngagement = new Date().toISOString().slice(0, 10);
    const created: Array<{
      placement_task_id: string;
      clickup_task_id: string;
      clickup_task_url: string;
      name: string;
    }> = [];
    const failures: string[] = [];
    const chatItems: Array<{
      name: string;
      points: number;
      url: string;
      assigneeClickupId: number | null;
    }> = [];
    let skipped = 0;

    for (const t of tasks) {
      if (t.clickup_task_id) {
        skipped++;
        continue;
      }
      const placement = placementById.get(t.placement_id);
      const lineName = placement?.item_name ?? "Deliverable";
      const o = overrides?.get(t.id);
      const name = o?.name?.trim() || `${lineName} — ${t.title}`;
      const points = Math.max(1, Math.round(Number(o?.points ?? t.points) || 1));
      const workStream =
        o?.work_stream?.trim() ||
        (t.department_id && workStreamByDept.get(t.department_id)) ||
        "Ad-hoc";
      // Conductor is the origin of every task — link back to the brief rather
      // than stamping a bare uuid nobody can act on.
      const stamp =
        `\n\n---\n_Scheduled from cost estimate ${(ce as { id: string }).id} on the ` +
        `[Conductor brief](https://conductor.convertedclick.co.za/briefs/view/${brief.id})` +
        ` on ${dateOfEngagement}${briefedByName ? ` by ${briefedByName}` : ""}._`;
      const description =
        (o?.description?.trim() ||
          `${t.title}\n\nDeliverable: ${lineName}\nBrief: ${brief.raw_subject ?? brief.id}`) + stamp;

      const taskBody = buildBriefTaskBody(cuFields, {
        name,
        description,
        clientName: client.clickup_client_name ?? client.name,
        workStream,
        engagementType: "Task",
        sprintPoints: points,
        dateOfEngagement,
        assigneeClickupId: o?.assignee_clickup_id ?? null,
        dueDateMs: dueDateToMs(o?.due_date),
      });
      // Stage-5 status choice — omitted → ClickUp uses the list default.
      if (b.status) taskBody.status = b.status;

      const taskUrl = `https://api.clickup.com/api/v2/list/${list.id}/task`;
      let createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
      // ClickUp rejects very large sprint-point values on create; retry once
      // without `points` rather than fail the task.
      if (!createRes.ok && "points" in taskBody) {
        const errText = await createRes.text();
        console.warn(`[schedule-brief-tasks] create failed with points (${createRes.status}: ${errText}); retrying without points`);
        const { points: _dropped, ...noPoints } = taskBody;
        createRes = await fetch(taskUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
      }
      if (!createRes.ok) {
        // Keep going — a single ClickUp failure must not abort the batch; the
        // re-run skips already-created rows via clickup_task_id.
        failures.push(`${name}: ${createRes.status} ${await createRes.text()}`);
        continue;
      }
      const cuTask = (await createRes.json()) as { id: string; url: string };

      // Audit comment on the task (best-effort).
      const comment = buildBriefComment({
        client_name: client.name,
        engagement_type: "Task",
        work_stream: workStream,
        sprint_points: points,
        date_of_engagement: dateOfEngagement,
        source_quote_id: `ce:${(ce as { id: string }).id}`,
      });
      const commentRes = await fetch(`https://api.clickup.com/api/v2/task/${cuTask.id}/comment`, {
        ...CU,
        method: "POST",
        body: JSON.stringify({ comment_text: comment, notify_all: false }),
      });
      if (!commentRes.ok) {
        console.error(`[schedule-brief-tasks] BRIEF:: comment failed for ${cuTask.id}: ${commentRes.status}`);
      }

      const { error: stampErr } = await sb
        .from("placement_tasks")
        .update({
          clickup_task_id: cuTask.id,
          clickup_task_url: cuTask.url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (stampErr) {
        // Orphan guard: task exists in ClickUp but isn't stamped — surface
        // loudly so the operator reconciles instead of re-running into a dupe.
        console.error(`[schedule-brief-tasks] ORPHANED TASK ${cuTask.id} for placement_task ${t.id}: ${stampErr.message}`);
        failures.push(`${name}: created (${cuTask.url}) but DB stamp failed — reconcile manually`);
        continue;
      }
      created.push({
        placement_task_id: t.id,
        clickup_task_id: cuTask.id,
        clickup_task_url: cuTask.url,
        name,
      });
      chatItems.push({
        name,
        points,
        url: cuTask.url,
        assigneeClickupId: o?.assignee_clickup_id ?? null,
      });
    }

    // Notify the client's ClickUp Chat channel (Converted Click fallback) —
    // mirrors create-quick-brief-task / create-adhoc-project. Best-effort:
    // the tasks already exist, so a failed post never fails the request.
    if (chatItems.length > 0) {
      const assigneeIds = [
        ...new Set(chatItems.map((c) => c.assigneeClickupId).filter((v): v is number => v != null)),
      ];
      const nameByClickupId = new Map<number, string>();
      if (assigneeIds.length > 0) {
        const { data: members } = await sb
          .from("team_members")
          .select("clickup_user_id, full_name")
          .in("clickup_user_id", assigneeIds);
        for (const m of (members ?? []) as Array<{ clickup_user_id: number | null; full_name: string | null }>) {
          if (m.clickup_user_id != null && m.full_name) nameByClickupId.set(m.clickup_user_id, m.full_name);
        }
      }
      const chatChannelId = client.clickup_chat_channel_id ?? CONVERTED_CLICK_CHANNEL_ID;
      const content =
        `🆕 New tasks briefed: **${brief.raw_subject ?? "brief"}** (${client.name}) · ` +
        `${chatItems.length} task${chatItems.length !== 1 ? "s" : ""} → "${list.name}"\n` +
        chatItems
          .map((c) => {
            const mention = mentionToken({
              clickupUserId: c.assigneeClickupId,
              name: c.assigneeClickupId != null ? nameByClickupId.get(c.assigneeClickupId) ?? null : null,
            });
            return `• ${mention} — ${c.name} · ${c.points} pt · ${c.url}`;
          })
          .join("\n");
      const chatRes = await postChatMessage(clickupPat, chatChannelId, content);
      if (!chatRes.ok) {
        console.error(
          `[schedule-brief-tasks] chat notify failed for brief ${brief.id} (channel ${chatChannelId}): ${chatRes.status ?? ""} ${chatRes.error ?? ""}`.trim(),
        );
      }
    }

    if (created.length > 0 || skipped > 0) {
      // Mark the pipeline stage complete (existing status used when work
      // lands in ClickUp) — only when nothing is left unscheduled.
      if (failures.length === 0) {
        // Scheduled work is new_billable by definition — billed via the cost
        // estimate, outside the retainer — so the brief is adhoc billing.
        await sb
          .from("briefs")
          .update({ status: "briefed", billing_type: "adhoc", updated_at: new Date().toISOString() })
          .eq("id", brief.id);
      }
      // In-app audit note (best-effort) — shows in the brief timeline.
      const summary =
        `Scheduled ${created.length} team task(s) to ClickUp list "${list.name}"` +
        `${skipped ? ` (${skipped} already scheduled)` : ""}` +
        `${failures.length ? ` · ${failures.length} FAILED` : ""}` +
        `${briefedByName ? ` · by ${briefedByName}` : ""}`;
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
      if (noteErr) console.error(`[schedule-brief-tasks] audit note failed: ${noteErr.message}`);
    }

    if (created.length === 0 && failures.length > 0) {
      return json({ error: `All task creates failed: ${failures.join(" | ")}` }, 502);
    }
    return json({ created, skipped, failures, list_id: list.id, list_name: list.name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
