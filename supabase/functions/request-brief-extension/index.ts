// supabase/functions/request-brief-extension/index.ts
//
// Record + apply an extension on a briefed task: a new due date and/or extra
// sprint points, with a required reason. Due-date moves apply to the ClickUp
// task immediately. A sprint-point (extra effort) extension can be flagged
// billable — then the extra points are HELD (client_approval_status = pending)
// and only written to ClickUp once the client approves. The original commitment
// (original_due_date / original_points) is frozen so the late/over-budget flags
// still measure against what was first agreed. Everything is logged to
// brief_extensions for the task's history.
//
// Create:   POST { brief_id, reason, new_due_date?, new_sprint_points?, billable?, requested_by_member_id? }
// Approve:  POST { action: "approve" | "decline", extension_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { postChatMessage } from "../_shared/clickup-chat.ts";

const POINT_TO_MIN = 15; // keep in sync with _shared/clickup.ts

function msToDateStr(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(Number(ms)).toISOString().slice(0, 10);
}
function dateStrToMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}
function fmtDue(s: string | null): string {
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}
/** Apply a points value to a ClickUp task (native points + derived estimate). */
async function putPoints(taskApi: string, CU: RequestInit, points: number): Promise<Response> {
  return await fetch(taskApi, {
    ...CU,
    method: "PUT",
    body: JSON.stringify({ points, time_estimate: Math.round(points * POINT_TO_MIN * 60_000) }),
  });
}
/** Append an internal timeline note to a brief (matches useAddInternalNote's shape). */
// deno-lint-ignore no-explicit-any
async function note(sb: any, briefId: string, text: string): Promise<void> {
  await sb.from("brief_messages").insert({
    brief_id: briefId,
    gmail_message_id: `note-${crypto.randomUUID()}`,
    direction: "note",
    body_text: text,
    relayed_by: "conductor",
    sent_at: new Date().toISOString(),
    to_emails: [],
    cc_emails: [],
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as {
      action?: "approve" | "decline";
      extension_id?: string;
      brief_id?: string;
      reason?: string;
      new_due_date?: string | null;
      new_sprint_points?: number;
      billable?: boolean;
      requested_by_member_id?: string | null;
    };
    const sb = createServiceRoleClient();
    const { token: clickupPat } = await getOperatorClickupToken(req);
    if (!clickupPat) return json({ error: "CLICKUP_PAT secret not set" }, 500);
    const CU = { headers: { Authorization: clickupPat, "Content-Type": "application/json" } };

    // ── Approve / decline a pending billable point extension ─────────────────
    if (body.action) {
      if (!body.extension_id) return json({ error: "extension_id required" }, 400);
      const { data: ext, error: eErr } = await sb
        .from("brief_extensions")
        .select("id, brief_id, new_points, client_approval_status, applied, brief:briefs(raw_subject, clickup_task_id, clickup_task_url, client:clients(clickup_chat_channel_id))")
        .eq("id", body.extension_id)
        .single();
      if (eErr || !ext) return json({ error: eErr?.message ?? "Extension not found" }, 404);
      const brief = (ext as unknown as { brief?: { raw_subject: string | null; clickup_task_id: string | null; clickup_task_url: string | null; client?: { clickup_chat_channel_id: string | null } | null } }).brief;
      if (body.action === "decline") {
        await sb.from("brief_extensions").update({ client_approval_status: "declined" }).eq("id", ext.id);
        await note(sb, ext.brief_id, "📅 Extension declined by client — extra points not applied.");
        return json({ ok: true, client_approval_status: "declined" });
      }
      // approve → commit the held points to ClickUp
      if (!brief?.clickup_task_id) return json({ error: "Brief has no ClickUp task." }, 400);
      if (ext.new_points != null) {
        const res = await putPoints(`https://api.clickup.com/api/v2/task/${brief.clickup_task_id}`, CU, Number(ext.new_points));
        if (!res.ok) return json({ error: `ClickUp update ${res.status}: ${await res.text()}` }, 502);
      }
      await sb.from("brief_extensions").update({ client_approval_status: "approved", applied: true }).eq("id", ext.id);
      if (brief.client?.clickup_chat_channel_id) {
        await postChatMessage(clickupPat, brief.client.clickup_chat_channel_id, `✅ Extension approved by client: ${brief.raw_subject ?? "task"} — now ${ext.new_points} pts\n${brief.clickup_task_url ?? ""}`.trim());
      }
      await note(sb, ext.brief_id, `✅ Extension approved by client — task set to ${ext.new_points} pts.`);
      return json({ ok: true, client_approval_status: "approved" });
    }

    // ── Create an extension ──────────────────────────────────────────────────
    if (!body.brief_id) return json({ error: "brief_id required" }, 400);
    const reason = (body.reason ?? "").trim();
    if (!reason) return json({ error: "A reason for the extension is required." }, 400);
    const hasDue = body.new_due_date !== undefined;
    const hasPoints = typeof body.new_sprint_points === "number" && Number.isFinite(body.new_sprint_points);
    if (!hasDue && !hasPoints) return json({ error: "Provide a new due date and/or new sprint points." }, 400);

    const { data: brief, error: bErr } = await sb
      .from("briefs")
      .select("id, raw_subject, clickup_task_id, clickup_task_url, original_points, original_due_date, client:clients(name, clickup_chat_channel_id)")
      .eq("id", body.brief_id)
      .single();
    if (bErr || !brief) return json({ error: bErr?.message ?? "Brief not found" }, 404);
    if (!brief.clickup_task_id) return json({ error: "This brief has not been briefed into ClickUp yet." }, 400);
    const taskApi = `https://api.clickup.com/api/v2/task/${brief.clickup_task_id}`;

    const cur = await fetch(taskApi, CU);
    if (!cur.ok) return json({ error: `ClickUp get ${cur.status}: ${await cur.text()}` }, 502);
    const t = await cur.json() as { points?: number | null; due_date?: string | null };
    const prevPoints = t.points ?? null;
    const prevDue = msToDateStr(t.due_date ? Number(t.due_date) : null);
    const newPoints = hasPoints ? (body.new_sprint_points as number) : prevPoints;
    const newDue = hasDue ? (body.new_due_date ?? null) : prevDue;

    // Billable point extensions hold the extra points until the client approves.
    const billable = body.billable === true && hasPoints;
    const holdPoints = billable && hasPoints;

    // Freeze the original commitment the first time it's touched.
    const briefPatch: Record<string, unknown> = {};
    if (brief.original_points == null && prevPoints != null) briefPatch.original_points = prevPoints;
    if (brief.original_due_date == null && prevDue != null) briefPatch.original_due_date = prevDue;

    // Apply what can apply now (due always; points only if not held for approval).
    const update: Record<string, unknown> = {};
    if (hasDue) {
      const ms = dateStrToMs(body.new_due_date);
      update.due_date = ms;
      if (ms !== null) update.due_date_time = false;
    }
    if (hasPoints && !holdPoints) {
      update.points = body.new_sprint_points;
      update.time_estimate = Math.round((body.new_sprint_points as number) * POINT_TO_MIN * 60_000);
    }
    if (Object.keys(update).length > 0) {
      let res = await fetch(taskApi, { ...CU, method: "PUT", body: JSON.stringify(update) });
      if (!res.ok && "points" in update) {
        const { points: _p, time_estimate: _t, ...noPoints } = update;
        res = await fetch(taskApi, { ...CU, method: "PUT", body: JSON.stringify(noPoints) });
      }
      if (!res.ok) return json({ error: `ClickUp update ${res.status}: ${await res.text()}` }, 502);
    }

    const { data: inserted } = await sb.from("brief_extensions").insert({
      brief_id: brief.id,
      reason,
      prev_due_date: prevDue,
      new_due_date: hasDue ? newDue : null,
      prev_points: prevPoints,
      new_points: hasPoints ? newPoints : null,
      billable,
      client_approval_status: holdPoints ? "pending" : "none",
      applied: !holdPoints,
      created_by: body.requested_by_member_id ?? null,
    }).select("id").single();
    if (Object.keys(briefPatch).length > 0) {
      await sb.from("briefs").update({ ...briefPatch, updated_at: new Date().toISOString() }).eq("id", brief.id);
    }

    const parts: string[] = [];
    if (hasDue) parts.push(`due ${fmtDue(prevDue)} → ${fmtDue(newDue)}`);
    if (hasPoints) parts.push(`${prevPoints ?? "—"} → ${newPoints} pts${holdPoints ? " (pending client sign-off)" : ""}`);
    const summary = parts.join(", ");

    const client = (brief as unknown as { client?: { name: string; clickup_chat_channel_id: string | null } | null }).client;
    if (client?.clickup_chat_channel_id) {
      const prefix = holdPoints ? "💬 Extension needs client quote/approval" : "📅 Extension on";
      await postChatMessage(clickupPat, client.clickup_chat_channel_id, `${prefix}: ${brief.raw_subject ?? "task"} — ${summary} · reason: ${reason}\n${brief.clickup_task_url ?? ""}`.trim());
    }
    await note(sb, brief.id, `📅 Extension recorded: ${summary}. Reason: ${reason}${holdPoints ? " — extra points quoted to client, awaiting approval." : ""}`);

    return json({
      ok: true,
      extension_id: inserted?.id ?? null,
      prev_due_date: prevDue,
      new_due_date: hasDue ? newDue : prevDue,
      prev_points: prevPoints,
      new_points: hasPoints ? newPoints : prevPoints,
      client_approval_status: holdPoints ? "pending" : "none",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
