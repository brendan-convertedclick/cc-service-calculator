// supabase/functions/update-briefed-task/index.ts
//
// Edit an already-briefed brief's ClickUp task in place: task name, sprint
// points, and due date. The task — not Conductor — is the source of truth for
// these fields, so this reads live values on GET and writes them back on POST.
//
// POST { brief_id, mode: "read" }                              → current values
// POST { brief_id, mode: "write", task_name?, sprint_points?, due_date? } → updated values
// (GET ?brief_id=<id> also returns current values.)
// Both return 200 { task_name, sprint_points, due_date, clickup_task_url }.
//
// due_date is exchanged as a plain "YYYY-MM-DD" string (or null); ClickUp uses
// epoch-ms internally. Points map to ClickUp's NATIVE `points` field plus a
// derived time_estimate, mirroring create-quick-brief-task. ClickUp rejects
// very large point values, so a failed write retries once without `points`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { cuFetch, resolveDropdownOption, type CuField } from "../_shared/clickup.ts";

const POINT_TO_MIN = 15; // keep in sync with _shared/clickup.ts
/** Keep in sync with WAITING_STATUSES in src/hooks/useSignoffCandidates.ts. */
const WAITING_STATUSES = ["waiting on client", "send to client"];

/** ms epoch → "YYYY-MM-DD" (UTC), or null. */
function msToDateStr(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → ms epoch (UTC midnight), or null. */
function dateStrToMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const sb = createServiceRoleClient();
    const { token: clickupPat } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };

    // Resolve brief_id from query (GET) or body (POST).
    let briefId: string | undefined;
    let body: {
      brief_id?: string;
      /** Write path for a task that has no brief — a provisioned recurring task,
       *  say. Everything ClickUp-side works the same; the Conductor mirror is
       *  skipped because there is no row to mirror onto. */
      clickup_task_id?: string;
      mode?: "read" | "write";
      task_name?: string;
      sprint_points?: number;
      due_date?: string | null;
      assignee_member_id?: string | null;
      with_client?: boolean;
      description?: string;
      status?: string;
      work_stream?: string;
      // Conductor-only. These never reach ClickUp: they decide which retainer
      // the work is booked to and whether it is billable, which is Conductor's
      // question, not the task's.
      billing_type?: "retainer" | "adhoc" | "internal";
      parent_project_id?: string | null;
    } = {};
    if (req.method === "GET") {
      briefId = new URL(req.url).searchParams.get("brief_id") ?? undefined;
      body = { mode: "read" };
    } else if (req.method === "POST") {
      body = await req.json();
      briefId = body.brief_id;
    } else {
      return json({ error: "GET or POST only" }, 405);
    }
    if (!briefId && !body.clickup_task_id) return json({ error: "brief_id required" }, 400);
    const isRead = req.method === "GET" || body.mode === "read";

    type BriefRow = {
      id: string | null;
      raw_subject: string | null;
      clickup_task_id: string | null;
      clickup_task_url: string | null;
      assignee_id: string | null;
      original_points: number | null;
      original_due_date: string | null;
      client_wait_ms: number | null;
      client_delay_manual: unknown;
      billing_type: string | null;
      parent_project_id: string | null;
      client_id: string | null;
    };
    let brief: BriefRow;
    if (briefId) {
      const { data, error: bErr } = await sb
        .from("briefs")
        .select("id, raw_subject, clickup_task_id, clickup_task_url, assignee_id, original_points, original_due_date, client_wait_ms, client_delay_manual, billing_type, parent_project_id, client_id")
        .eq("id", briefId)
        .single();
      if (bErr || !data) return json({ error: bErr?.message ?? "Brief not found" }, 404);
      brief = data as BriefRow;
    } else {
      brief = {
        id: null,
        raw_subject: null,
        clickup_task_id: body.clickup_task_id!,
        clickup_task_url: `https://app.clickup.com/t/${body.clickup_task_id}`,
        assignee_id: null,
        // Nothing to freeze: there is no brief to hold an original allocation.
        original_points: 0,
        original_due_date: null,
        client_wait_ms: null,
        client_delay_manual: null,
        billing_type: null,
        parent_project_id: null,
        client_id: null,
      };
    }
    if (!brief.clickup_task_id) {
      return json({ error: "This brief has not been briefed into ClickUp yet." }, 400);
    }
    const taskId = brief.clickup_task_id as string;
    const taskApi = `https://api.clickup.com/api/v2/task/${taskId}`;

    // ── read: return the task's current name / points / due date + completion ─
    if (isRead) {
      const res = await cuFetch(taskApi, CU);
      if (!res.ok) return json({ error: `ClickUp get ${res.status}: ${await res.text()}` }, 502);
      const t = await res.json() as {
        name?: string;
        points?: number | null;
        due_date?: string | null;
        date_created?: string | null;
        date_closed?: string | null;
        date_done?: string | null;
        time_estimate?: number | null;
        time_spent?: number | null;
        status?: { status?: string; type?: string } | null;
        description?: string | null;
        text_content?: string | null;
        list?: { id?: string } | null;
        assignees?: Array<{ id: number }> | null;
        custom_fields?: Array<
          {
            name?: string;
            type?: string;
            value?: unknown;
            type_config?: { options?: Array<{ id: string; name?: string; orderindex?: number }> };
          }
        > | null;
      };
      // Estimated points = the ORIGINAL allocation (frozen), not the current
      // (possibly-edited) task points. Freeze it the first time we see points.
      let originalPoints = brief.original_points != null ? Number(brief.original_points) : null;
      if (originalPoints == null && t.points != null) {
        originalPoints = t.points;
        await sb.from("briefs").update({ original_points: originalPoints }).eq("id", briefId);
      }
      // Estimated hours derived from the original points (1 pt = POINT_TO_MIN min).
      const estHours = originalPoints != null
        ? Math.round((originalPoints * POINT_TO_MIN / 60) * 100) / 100
        : null;
      // Actual hours come from tracked time; actual points invert points→minutes.
      const actualHours = t.time_spent
        ? Math.round((Number(t.time_spent) / 3_600_000) * 100) / 100
        : 0;
      const actualPoints = t.time_spent
        ? Math.round((Number(t.time_spent) / 60_000 / POINT_TO_MIN) * 100) / 100
        : 0;
      const completedMs = t.date_done ?? t.date_closed ?? null;
      const statusType = t.status?.type ?? null;
      const isComplete = !!completedMs || statusType === "closed" || statusType === "done";
      // The statuses this task's list actually offers. Never hardcoded: client
      // spaces use custom status sets, and "to do" does not exist in them.
      let availableStatuses: string[] = [];
      if (t.list?.id) {
        const lr = await cuFetch(`https://api.clickup.com/api/v2/list/${t.list.id}`, CU);
        if (lr.ok) {
          const l = await lr.json() as { statuses?: Array<{ status?: string; type?: string }> };
          availableStatuses = (l.statuses ?? [])
            // A task is closed in ClickUp, not from here: closing sets
            // completed_at on the next sync and moves every retainer figure,
            // so offering it in an edit dialog invites an accident.
            .filter((s) => s.type !== "closed" && s.type !== "done")
            .map((s) => s.status ?? "")
            .filter(Boolean);
        }
      }
      const workStreamField = (t.custom_fields ?? []).find(
        (f) => f.name?.trim().toLowerCase() === "work stream" && f.type === "drop_down",
      );
      // A drop_down reads back as its ORDERINDEX (a number), not its option id —
      // the id is what you WRITE. Matching on id alone silently reported every
      // work stream as unset. Handle both, since ClickUp is not consistent
      // about it across field types.
      const wsValue = workStreamField?.value;
      const workStream = workStreamField
        ? workStreamField.type_config?.options?.find((o) =>
          typeof wsValue === "number" ? o.orderindex === wsValue : o.id === String(wsValue ?? ""),
        )?.name ?? null
        : null;

      return json({
        task_name: t.name ?? brief.raw_subject ?? "",
        sprint_points: t.points ?? null, // current (editable) task points
        due_date: msToDateStr(t.due_date ? Number(t.due_date) : null),
        clickup_task_url: brief.clickup_task_url,
        // Completion metrics (populated once time is tracked / task is closed).
        status_label: t.status?.status ?? null,
        is_complete: isComplete,
        completed_at: msToDateStr(completedMs ? Number(completedMs) : null),
        estimated_points: originalPoints, // the ORIGINAL allocation, frozen
        estimated_hours: estHours,
        actual_points: actualPoints,
        actual_hours: actualHours,
        // Timeline anchors: when briefed into ClickUp + the original committed due date.
        briefed_at: msToDateStr(t.date_created ? Number(t.date_created) : null),
        original_due_date: brief.original_due_date ?? null,
        // Client-waiting clock (ms in "waiting on client"/"send to client"), synced by cron.
        client_wait_ms: brief.client_wait_ms ?? null,
        // Operator override: this late delivery was manually flagged client-caused.
        client_delay_manual: brief.client_delay_manual ?? false,
        // The rest of what the brief carried, so one dialog can edit all of it.
        description: t.description ?? t.text_content ?? "",
        work_stream: workStream,
        available_statuses: availableStatuses,
        assignee_member_id: brief.assignee_id ?? null,
        billing_type: brief.billing_type ?? null,
        parent_project_id: brief.parent_project_id ?? null,
        client_id: brief.client_id ?? null,
        clickup_list_id: t.list?.id ?? null,
      });
    }

    // ── POST: write the edited fields back to ClickUp ────────────────────────
    const update: Record<string, unknown> = {};
    if (typeof body.task_name === "string" && body.task_name.trim()) {
      update.name = body.task_name.trim();
    }
    if (typeof body.sprint_points === "number" && Number.isFinite(body.sprint_points)) {
      update.points = body.sprint_points;
      update.time_estimate = Math.round(body.sprint_points * POINT_TO_MIN * 60_000);
    }
    if (typeof body.description === "string") {
      // ClickUp is the source of truth for the body text — briefs has no
      // description column, the three brief text boxes are composed into this
      // at creation and never stored separately.
      update.description = body.description;
    }
    if (typeof body.status === "string" && body.status.trim()) {
      update.status = body.status.trim();
    }
    if (body.due_date !== undefined) {
      const ms = dateStrToMs(body.due_date);
      update.due_date = ms; // null clears the due date
      if (ms !== null) update.due_date_time = false;
    }

    // "With the client": nobody here owns it, so the task carries the list's
    // waiting-on-client status — the signal the sign-off inbox already reads
    // (useSignoffCandidates.WAITING_STATUSES). The status name is resolved from
    // the task's own list rather than hardcoded, because lists spell it
    // differently ("waiting on client" / "send to client") and a name the list
    // doesn't have makes ClickUp reject the whole update.
    let waitingStatus: string | null = null;
    if (body.with_client) {
      const cur = await cuFetch(taskApi, CU);
      if (!cur.ok) return json({ error: `ClickUp get ${cur.status}: ${await cur.text()}` }, 502);
      const listId = ((await cur.json()) as { list?: { id?: string } }).list?.id;
      if (!listId) return json({ error: "Could not read the task's ClickUp list." }, 502);
      const listRes = await cuFetch(`https://api.clickup.com/api/v2/list/${listId}`, CU);
      if (!listRes.ok) return json({ error: `ClickUp list ${listRes.status}: ${await listRes.text()}` }, 502);
      const statuses = ((await listRes.json()) as { statuses?: Array<{ status?: string }> }).statuses ?? [];
      waitingStatus = statuses
        .map((s) => s.status ?? "")
        .find((s) => WAITING_STATUSES.includes(s.toLowerCase())) ?? null;
      if (!waitingStatus) {
        return json({ error: "This task's ClickUp list has no waiting-on-client status." }, 400);
      }
      update.status = waitingStatus;
    }

    // Reassignment: resolve the new member → ClickUp user, then swap the task's
    // assignees (rem the current ones, add the new one). null clears assignees.
    let newAssigneeMemberId: string | null | undefined;
    if (body.assignee_member_id !== undefined) {
      newAssigneeMemberId = body.assignee_member_id;
      let newClickupId: number | null = null;
      if (body.assignee_member_id) {
        const { data: m } = await sb
          .from("team_members")
          .select("clickup_user_id")
          .eq("id", body.assignee_member_id)
          .maybeSingle();
        newClickupId = (m as { clickup_user_id: number | null } | null)?.clickup_user_id ?? null;
        if (!newClickupId) return json({ error: "That team member has no linked ClickUp user." }, 400);
      }
      // Current assignees come from the live task so we can remove them cleanly.
      const cur = await cuFetch(taskApi, CU);
      if (!cur.ok) return json({ error: `ClickUp get ${cur.status}: ${await cur.text()}` }, 502);
      const curTask = await cur.json() as { assignees?: Array<{ id: number }> };
      const currentIds = (curTask.assignees ?? []).map((a) => a.id);
      const rem = currentIds.filter((id) => id !== newClickupId);
      const add = newClickupId && !currentIds.includes(newClickupId) ? [newClickupId] : [];
      update.assignees = { add, rem };
    }

    // Three kinds of edit, and only the first rides the task PUT:
    //   the task itself  → `update`
    //   Work Stream      → its own custom-field endpoint
    //   billing/retainer → Conductor columns, never sent to ClickUp
    // Any one of them alone is a real save.
    const wantsWorkStream = typeof body.work_stream === "string" && !!body.work_stream.trim();
    const conductorOnly = body.billing_type !== undefined || body.parent_project_id !== undefined;
    const hasTaskUpdate = Object.keys(update).length > 0;
    if (!hasTaskUpdate && !wantsWorkStream && !conductorOnly) {
      return json({ error: "No fields to update." }, 400);
    }

    // If points are being changed and the original allocation was never frozen,
    // capture the CURRENT (pre-edit) task points as the original first.
    if (body.sprint_points !== undefined && brief.original_points == null) {
      const pre = await cuFetch(taskApi, CU);
      if (pre.ok) {
        const preTask = await pre.json() as { points?: number | null };
        if (preTask.points != null) {
          await sb.from("briefs").update({ original_points: preTask.points }).eq("id", briefId);
        }
      }
    }

    if (!hasTaskUpdate && !wantsWorkStream) {
      // Nothing for ClickUp at all; write the Conductor side and return.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.billing_type !== undefined) patch.billing_type = body.billing_type;
      if (body.parent_project_id !== undefined) patch.parent_project_id = body.parent_project_id;
      const { error: pErr } = await sb.from("briefs").update(patch).eq("id", briefId);
      if (pErr) return json({ error: pErr.message }, 500);
      return json({
        task_name: brief.raw_subject ?? "",
        sprint_points: brief.original_points != null ? Number(brief.original_points) : null,
        due_date: brief.original_due_date ?? null,
        clickup_task_url: brief.clickup_task_url,
      });
    }

    let res = await cuFetch(taskApi, { ...CU, method: "PUT", body: JSON.stringify(update) });
    // ClickUp rejects very large point values; retry once without `points`
    // (time_estimate + the other fields still apply). See the points-cap note.
    if (!res.ok && "points" in update) {
      const errText = await res.text();
      console.warn(`[update-briefed-task] PUT failed with points (${res.status}: ${errText}); retrying without points`);
      const { points: _p, time_estimate: _t, ...noPoints } = update;
      res = await cuFetch(taskApi, { ...CU, method: "PUT", body: JSON.stringify(noPoints) });
    }
    if (!res.ok) return json({ error: `ClickUp update ${res.status}: ${await res.text()}` }, 502);

    // Work Stream is a dropdown CUSTOM field, so it does not ride the task PUT
    // and it must be sent as the OPTION ID — posting the label is a 400
    // FIELD_011, and only a live write ever surfaces that.
    if (wantsWorkStream) {
      const cur = await cuFetch(taskApi, CU);
      const listId = cur.ok
        ? ((await cur.json()) as { list?: { id?: string } }).list?.id ?? null
        : null;
      if (listId) {
        const fr = await cuFetch(`https://api.clickup.com/api/v2/list/${listId}/field`, CU);
        if (fr.ok) {
          const { fields } = await fr.json() as { fields?: CuField[] };
          const opt = resolveDropdownOption(fields ?? [], "Work Stream", body.work_stream!);
          if (opt) {
            // Best-effort, like the checklist push: the task and every other
            // edit already landed, and failing the whole save over one dropdown
            // would lose them.
            const wr = await cuFetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${opt.id}`, {
              ...CU,
              method: "POST",
              body: JSON.stringify({ value: opt.value }),
            });
            if (!wr.ok) console.error(`work stream set failed: ${wr.status} ${await wr.text()}`);
          } else {
            console.error(`work stream "${body.work_stream}" is not an option on list ${listId}`);
          }
        }
      }
    }
    const t = await res.json() as { name?: string; points?: number | null; due_date?: string | null };

    // Mirror the task name / assignee onto the Conductor brief so the list stays
    // in sync with what's now in ClickUp.
    const briefPatch: Record<string, unknown> = {};
    if (typeof update.name === "string" && update.name !== brief.raw_subject) {
      briefPatch.raw_subject = update.name;
    }
    if (newAssigneeMemberId !== undefined && newAssigneeMemberId !== brief.assignee_id) {
      briefPatch.assignee_id = newAssigneeMemberId;
    }
    if (body.billing_type !== undefined) briefPatch.billing_type = body.billing_type;
    if (body.parent_project_id !== undefined) briefPatch.parent_project_id = body.parent_project_id;
    // Mirror the status so the sign-off candidate query sees it now rather than
    // at the next sync-clickup-actuals tick.
    if (waitingStatus) briefPatch.clickup_task_status = waitingStatus;
    if (briefId && Object.keys(briefPatch).length > 0) {
      briefPatch.updated_at = new Date().toISOString();
      await sb.from("briefs").update(briefPatch).eq("id", briefId);
    }

    return json({
      task_name: t.name ?? (update.name as string | undefined) ?? brief.raw_subject ?? "",
      sprint_points: t.points ?? null,
      due_date: msToDateStr(t.due_date ? Number(t.due_date) : null),
      clickup_task_url: brief.clickup_task_url,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
