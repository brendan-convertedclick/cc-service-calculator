// supabase/functions/_shared/meeting-clickup.ts
//
// The ClickUp knowledge a meeting task needs: which list it belongs in, what
// shape the task body takes, which custom fields to resolve, and the
// points-retry ClickUp forces on us.
//
// Extracted from manage-internal-meeting when sync-calendar-meetings became a
// second writer of meeting tasks. Both call these; neither owns them. The
// orchestration around them (per-person loops, chat announcements, RSVP
// handling) stays with each caller, because it genuinely differs — a meeting
// we scheduled announces itself to the team, a meeting we merely noticed on
// someone's calendar does not.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveDropdownOption, type CuField } from "./clickup.ts";

export const NO_CLICKUP_LIST_ERROR =
  "No Meetings, Overhead or Admin list found in this client's ClickUp folder - add one (then re-sync the client's lists), or set a fallback internal list in Settings -> ClickUp.";

/** ClickUp list NAMES that are a sane home for a meeting, best first. */
const MEETING_LIST_NAMES = ["meetings", "overhead", "admin", "administration"];

/**
 * Resolve the ClickUp list a meeting's task belongs in, by list NAME.
 *
 * Deliberately does NOT use client_lists.group_id. Migration 0048's four
 * task_groups were only ever rolled out to three folders; on the rest the
 * group tags are arbitrary — as of 2026-07-29 the "meetings" group points at
 * lists literally named Paid Media, Content, General and Strategy, so routing
 * by group would drop meeting tasks into client delivery lists. Matching the
 * name covers 30 of 31 clients (3 have a real "Meetings" list, 27 an "Admin"
 * one) and degrades to a clear error instead of a wrong list.
 */
export async function resolveMeetingListId(
  sb: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data: listRows } = await sb
    .from("client_lists")
    .select("clickup_list_id, clickup_list_name")
    .eq("client_id", clientId)
    .is("archived_at", null);
  const lists = (listRows ?? []) as Array<
    { clickup_list_id: string | null; clickup_list_name: string | null }
  >;

  for (const name of MEETING_LIST_NAMES) {
    const hit = lists.find((l) => l.clickup_list_name?.trim().toLowerCase() === name);
    if (hit?.clickup_list_id) return hit.clickup_list_id;
  }

  // Last resort: the pre-0048 single-internal-list setting.
  const { data: settingsRow } = await sb
    .from("settings")
    .select("clickup_internal_list_id")
    .eq("id", 1)
    .maybeSingle();
  return (settingsRow as { clickup_internal_list_id: string | null } | null)
    ?.clickup_internal_list_id ?? null;
}

/**
 * The native ClickUp fields of a meeting task.
 *
 * `status` is omitted entirely unless staff explicitly picked one — a
 * hardcoded "to do" fails with CRTSK_001 on every list whose default status
 * is something else (the Clients space defaults to "backlog").
 */
export function nativeMeetingTaskBody(input: {
  description: string;
  startsAtMs: number;
  endsAtMs: number;
  points: number;
  statusOverride?: string | null;
}): Record<string, unknown> {
  return {
    description: input.description,
    points: input.points,
    time_estimate: input.endsAtMs - input.startsAtMs,
    start_date: input.startsAtMs,
    start_date_time: true,
    due_date: input.endsAtMs,
    due_date_time: true,
    ...(input.statusOverride ? { status: input.statusOverride } : {}),
  };
}

/** Dropdown custom fields, resolved to option ids — labels fail with FIELD_011. */
export function meetingCustomFields(
  cuFields: CuField[],
  clickupClientName: string,
  workStream: string | null,
): Array<{ id: string; value: unknown }> {
  const cf: Array<{ id: string; value: unknown }> = [];
  const pushDropdown = (fieldName: string, value: string) => {
    const resolved = resolveDropdownOption(cuFields, fieldName, value);
    if (resolved) cf.push(resolved);
  };
  pushDropdown("Client Name", clickupClientName);
  pushDropdown("Engagement Type", "Task");
  if (workStream) pushDropdown("Work Stream", workStream);
  return cf;
}

/** Fetch a list's custom-field definitions. Empty array on any failure — a
 * task without its dropdowns is better than no task. */
export async function fetchListFields(pat: string, listId: string): Promise<CuField[]> {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, {
    headers: { Authorization: pat, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    console.warn(`[meeting-clickup] could not read field defs for list ${listId}: ${res.status}`);
    return [];
  }
  return ((await res.json()).fields ?? []) as CuField[];
}

export interface CreatedMeetingTask {
  taskId: string | null;
  taskUrl: string | null;
  error: string | null;
}

/**
 * Create one person's meeting task.
 *
 * One task per person, never one task co-assigned to several: ClickUp splits
 * native Sprint Points PER ASSIGNEE, so a 2-point meeting with two attendees
 * credits one of them and shows the other "- pt" (confirmed empirically
 * 2026-07-30, migration 0099).
 *
 * The retry exists because ClickUp rejects large sprint-point values on
 * create with no usable error. Dropping `points` and trying again keeps the
 * task — time_estimate still carries the effort.
 */
export async function createMeetingTask(
  pat: string,
  listId: string,
  input: {
    name: string;
    body: Record<string, unknown>;
    customFields: Array<{ id: string; value: unknown }>;
    clickupUserId: number | null;
    /** For the log line when the points retry fires. */
    label: string;
  },
): Promise<CreatedMeetingTask> {
  const CU = { headers: { Authorization: pat, "Content-Type": "application/json" } };
  const taskBody: Record<string, unknown> = {
    name: input.name,
    ...input.body,
    custom_fields: input.customFields,
  };
  if (input.clickupUserId) taskBody.assignees = [input.clickupUserId];

  const url = `https://api.clickup.com/api/v2/list/${listId}/task`;
  let res = await fetch(url, { ...CU, method: "POST", body: JSON.stringify(taskBody) });

  if (!res.ok && "points" in taskBody) {
    const errText = await res.text();
    console.warn(
      `[meeting-clickup] create failed with points for ${input.label} (${res.status}: ${errText}); retrying without points`,
    );
    const { points: _dropped, ...noPoints } = taskBody;
    res = await fetch(url, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
  }

  if (!res.ok) {
    return { taskId: null, taskUrl: null, error: `ClickUp create ${res.status}: ${await res.text()}` };
  }
  const created = await res.json() as { id: string; url: string };
  return { taskId: created.id, taskUrl: created.url, error: null };
}
