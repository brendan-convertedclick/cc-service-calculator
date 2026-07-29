// supabase/functions/manage-internal-meeting/index.ts
//
// Request:  POST { action: "create", organiser_member_id, client_id, project_id?,
//                   title, agenda?, starts_at, ends_at, attendee_member_ids: string[] }
//           → 200 { meeting_id, google_meet_url, google_html_link, clickup_task_url,
//                    google_sync_error?, clickup_sync_error? }
//
//           POST { action: "update", meeting_id, title?, agenda?, client_id?,
//                   project_id?, starts_at?, ends_at?, attendee_member_ids? }
//           → 200 { meeting_id, google_meet_url, clickup_task_url,
//                    google_sync_error?, clickup_sync_error? }
//
//           POST { action: "cancel", meeting_id }
//           → 200 { ok: true, google_sync_error?, clickup_sync_error? }
//
// The internal_meetings row is the source of truth and is written FIRST, before
// any Google Calendar or ClickUp call — a failure on either external system is
// recorded in google_sync_error / clickup_sync_error and returned to the caller,
// but never loses the meeting record or fails the request. A later successful
// sync (another update, or a retry) clears the corresponding error column.
//
// Google Calendar events live on the MEETING ORGANISER's own calendar
// (getGoogleAccessToken resolves by organiser_member_id on create). The
// resolved account is stamped into google_calendar_email so a later update or
// cancel patches/deletes the SAME event instead of risking a duplicate on a
// different calendar.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient, createUserClient } from "../_shared/supabase-client.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { getGoogleAccessToken } from "../_shared/google-token.ts";
import { createEvent, deleteEvent, getEvent, patchEvent, type AttendeeInput } from "../_shared/google-calendar.ts";
import { resolveDropdownOption, type CuField } from "../_shared/clickup.ts";
import {
  buildMeetingDescription,
  buildMeetingTaskName,
  extractMeetUrl,
  meetingSprintPoints,
} from "../_shared/meeting-logic.ts";

// ── Types ────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  full_name: string;
  email: string | null;
  clickup_user_id: number | null;
}
interface ClientRow {
  id: string;
  name: string;
  clickup_client_name: string | null;
}
interface ProjectRow {
  id: string;
  name: string;
  clickup_work_stream_override: string | null;
}
interface MeetingRow {
  id: string;
  organiser_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  agenda: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  google_event_id: string | null;
  google_calendar_email: string | null;
  google_meet_url: string | null;
  google_html_link: string | null;
  google_sync_error: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  clickup_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateBody {
  action: "create";
  organiser_member_id?: string;
  client_id?: string;
  project_id?: string | null;
  title?: string;
  agenda?: string | null;
  starts_at?: string;
  ends_at?: string;
  attendee_member_ids?: string[];
}
interface UpdateBody {
  action: "update";
  meeting_id?: string;
  title?: string;
  agenda?: string | null;
  client_id?: string;
  project_id?: string | null;
  starts_at?: string;
  ends_at?: string;
  attendee_member_ids?: string[];
}
interface CancelBody {
  action: "cancel";
  meeting_id?: string;
}
type ActionBody = CreateBody | UpdateBody | CancelBody;

interface GoogleSyncResult {
  eventId: string | null;
  googleEmail: string | null;
  meetUrl: string | null;
  htmlLink: string | null;
  error: string | null;
}
interface ClickupSyncResult {
  taskId: string | null;
  taskUrl: string | null;
  error: string | null;
}

/**
 * Every sync* function below does bare `fetch`/`res.json()` calls with no
 * try/catch of its own — a DNS blip, TLS reset, or a non-JSON response would
 * otherwise throw past the handler and hit the outer 500, which would lose
 * the meeting_id from the response even though the DB row was already
 * written. These wrappers turn any such throw into a normal sync_error
 * result instead, preserving whatever the row already had on an update
 * (never null out an existing google_event_id/clickup_task_id just because
 * this particular sync attempt blew up).
 */
async function safeGoogleSync(
  fn: () => Promise<GoogleSyncResult>,
  fallback: Pick<GoogleSyncResult, "eventId" | "googleEmail" | "meetUrl" | "htmlLink">,
): Promise<GoogleSyncResult> {
  try {
    return await fn();
  } catch (e) {
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

async function safeClickupSync(
  fn: () => Promise<ClickupSyncResult>,
  fallback: Pick<ClickupSyncResult, "taskId" | "taskUrl">,
): Promise<ClickupSyncResult> {
  try {
    return await fn();
  } catch (e) {
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

const NO_CLICKUP_LIST_ERROR =
  "No ClickUp list found for this client - add a Meetings or Overhead list to its folder (Clients -> [client] -> sync lists), or set a fallback internal list in Settings -> ClickUp.";
const NO_GOOGLE_ACCOUNT_ERROR =
  "No Google account connected — sign in with Google to grant calendar access";

// ── Small pure helpers ──────────────────────────────────────────────────

/** Dedupe emails (case-insensitive), dropping nulls and the excluded address. */
function dedupeEmailsExcluding(emails: Array<string | null>, exclude: string | null): string[] {
  const excludeLower = exclude?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    if (!email) continue;
    const lower = email.toLowerCase();
    if (lower === excludeLower || seen.has(lower)) continue;
    seen.add(lower);
    out.push(email);
  }
  return out;
}

function nativeMeetingTaskBody(input: {
  description: string;
  startsAtMs: number;
  endsAtMs: number;
  points: number;
}): Record<string, unknown> {
  return {
    description: input.description,
    points: input.points,
    time_estimate: input.endsAtMs - input.startsAtMs,
    start_date: input.startsAtMs,
    start_date_time: true,
    due_date: input.endsAtMs,
    due_date_time: true,
  };
}

function meetingCustomFields(
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

// ── Google Calendar sync ────────────────────────────────────────────────

interface GoogleSyncCtx {
  meeting: MeetingRow;
  organiser: TeamMember;
  client: ClientRow;
  project: ProjectRow | null;
  attendees: TeamMember[];
  /** True only when the caller's request explicitly changed attendee_member_ids.
   * Unset/false on create (irrelevant — a new event always sends the full list). */
  attendeesChanged?: boolean;
}

async function syncGoogleCreate(req: Request, ctx: GoogleSyncCtx): Promise<GoogleSyncResult> {
  const resolved = await getGoogleAccessToken(req, { memberId: ctx.organiser.id });
  if (!resolved.accessToken) {
    return {
      eventId: null,
      googleEmail: null,
      meetUrl: null,
      htmlLink: null,
      error: resolved.error ?? NO_GOOGLE_ACCOUNT_ERROR,
    };
  }
  const attendeeEmails = dedupeEmailsExcluding(
    [...ctx.attendees.map((a) => a.email), ctx.organiser.email],
    resolved.googleEmail,
  );
  const description = buildMeetingDescription({
    title: ctx.meeting.title,
    agenda: ctx.meeting.agenda,
    clientName: ctx.client.name,
    projectName: ctx.project?.name ?? null,
    attendeeNames: ctx.attendees.map((a) => a.full_name),
    meetUrl: null, // not known yet — the event doesn't exist until this call returns
    meetingId: ctx.meeting.id,
  });
  const result = await createEvent(resolved.accessToken, {
    summary: ctx.meeting.title,
    description,
    startIso: ctx.meeting.starts_at,
    endIso: ctx.meeting.ends_at,
    attendeeEmails,
  });
  if (!result.ok || !result.event) {
    return { eventId: null, googleEmail: resolved.googleEmail, meetUrl: null, htmlLink: null, error: result.error };
  }
  return {
    eventId: result.event.id,
    googleEmail: resolved.googleEmail,
    meetUrl: extractMeetUrl(result.event),
    htmlLink: result.event.htmlLink ?? null,
    error: null,
  };
}

async function syncGoogleUpdate(req: Request, ctx: GoogleSyncCtx): Promise<GoogleSyncResult> {
  // No event yet (Google wasn't connected — or failed — at create time):
  // attempt a fresh create now, exactly like the create path. This is what
  // lets a meeting self-heal once the organiser finally connects Google.
  if (!ctx.meeting.google_event_id) {
    return syncGoogleCreate(req, ctx);
  }

  // An event already exists. It MUST be patched on the SAME calendar it was
  // created on (events.patch on calendars/primary/events/{id} 404s on any
  // other account), so resolve strictly by the stored account — never fall
  // through to the organiser or the operator, which risks silently creating
  // a duplicate event on a second calendar.
  if (!ctx.meeting.google_calendar_email) {
    return {
      eventId: ctx.meeting.google_event_id,
      googleEmail: null,
      meetUrl: ctx.meeting.google_meet_url,
      htmlLink: ctx.meeting.google_html_link,
      error: "Meeting has a Google event but no recorded calendar account — reconnect Google and try again.",
    };
  }
  const resolved = await getGoogleAccessToken(req, { googleEmail: ctx.meeting.google_calendar_email });
  if (!resolved.accessToken) {
    return {
      eventId: ctx.meeting.google_event_id,
      googleEmail: ctx.meeting.google_calendar_email,
      meetUrl: ctx.meeting.google_meet_url,
      htmlLink: ctx.meeting.google_html_link,
      error: resolved.error ??
        `No Google account connected for ${ctx.meeting.google_calendar_email} — sign in with Google to grant calendar access`,
    };
  }
  // Only touch the attendee array when it actually changed — Google's patch
  // OVERWRITES arrays wholesale (not merges), so sending it unconditionally
  // resets every existing attendee's responseStatus (accepted/declined) back
  // to needsAction and re-sends invites to people who already responded.
  let attendeeEmails: AttendeeInput[] | undefined;
  if (ctx.attendeesChanged) {
    const existingEvent = await getEvent(resolved.accessToken, ctx.meeting.google_event_id);
    if (!existingEvent.ok) {
      // Couldn't read current RSVPs (404/403/429/...) — skip the attendee
      // patch entirely rather than send a bare-email array that would wipe
      // everyone's responseStatus. internal_meeting_attendees (the DB) is
      // still the source of truth, so nothing is lost; the next successful
      // edit retries.
      console.warn(
        `[manage-internal-meeting] could not read event ${ctx.meeting.google_event_id} to preserve RSVPs; leaving Google attendees unchanged`,
      );
    } else {
      const desired = dedupeEmailsExcluding(
        [...ctx.attendees.map((a) => a.email), ctx.organiser.email],
        resolved.googleEmail,
      );
      const existingStatus = new Map<string, string>();
      for (const a of existingEvent.event?.attendees ?? []) {
        if (a.email) existingStatus.set(a.email.toLowerCase(), a.responseStatus ?? "needsAction");
      }
      attendeeEmails = desired.map((email) => {
        const status = existingStatus.get(email.toLowerCase());
        return status ? { email, responseStatus: status } : email;
      });
    }
  }
  const description = buildMeetingDescription({
    title: ctx.meeting.title,
    agenda: ctx.meeting.agenda,
    clientName: ctx.client.name,
    projectName: ctx.project?.name ?? null,
    attendeeNames: ctx.attendees.map((a) => a.full_name),
    meetUrl: ctx.meeting.google_meet_url,
    meetingId: ctx.meeting.id,
  });
  const result = await patchEvent(resolved.accessToken, ctx.meeting.google_event_id, {
    summary: ctx.meeting.title,
    description,
    startIso: ctx.meeting.starts_at,
    endIso: ctx.meeting.ends_at,
    attendeeEmails,
    // Only re-request a conference if the stored meet url is missing —
    // resending createRequest on an event that already has one creates a
    // second, orphaned conference.
    // ponytail: Google's events.insert can come back with the conference
    // still "pending" (no hangoutLink yet), which stores google_meet_url as
    // null even though a conference IS being created. The next edit then
    // sees null and requests a SECOND conference, changing the Meet link
    // under attendees who saved the first one. Upgrade path: on create, if
    // extractMeetUrl(event) is null, do one extra GET of the event a few
    // seconds later to pick up the now-resolved hangoutLink before anyone
    // edits the meeting.
    requestConference: !ctx.meeting.google_meet_url,
  });
  if (!result.ok || !result.event) {
    return {
      eventId: ctx.meeting.google_event_id,
      googleEmail: resolved.googleEmail,
      meetUrl: ctx.meeting.google_meet_url,
      htmlLink: ctx.meeting.google_html_link,
      error: result.error,
    };
  }
  return {
    eventId: result.event.id,
    googleEmail: resolved.googleEmail,
    meetUrl: extractMeetUrl(result.event) ?? ctx.meeting.google_meet_url,
    htmlLink: result.event.htmlLink ?? ctx.meeting.google_html_link,
    error: null,
  };
}

// ── ClickUp sync ────────────────────────────────────────────────────────

interface ClickupSyncCreateCtx {
  sb: SupabaseClient;
  meeting: MeetingRow;
  client: ClientRow;
  project: ProjectRow | null;
  attendees: TeamMember[];
  meetUrl: string | null;
}

/**
 * Resolve the ClickUp list a meeting's task belongs in.
 *
 * Internal meetings are client-linked, and migration 0048 already maps every
 * client's ClickUp folder to one list per task_group. So a meeting belongs in
 * that client's "Meetings" list, falling back to its "Overhead" list, and only
 * then to settings.clickup_internal_list_id — the pre-0048 single-internal-list
 * model, which is unset on this project.
 *
 * Which list is chosen does NOT affect billing classification: get-productivity
 * keys overhead off the meeting's task id, not its list.
 */
async function resolveMeetingListId(
  sb: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data: groupRows } = await sb
    .from("task_groups")
    .select("id, label_key")
    .in("label_key", ["meetings", "overhead"]);
  const groups = (groupRows ?? []) as Array<{ id: string; label_key: string }>;

  if (groups.length > 0) {
    const { data: listRows } = await sb
      .from("client_lists")
      .select("clickup_list_id, group_id")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .in("group_id", groups.map((g) => g.id));
    const lists = (listRows ?? []) as Array<{ clickup_list_id: string | null; group_id: string }>;
    // Meetings first, Overhead second — both keep the task out of the
    // client's Delivery list, where it would read as billable work in ClickUp.
    for (const key of ["meetings", "overhead"]) {
      const groupId = groups.find((g) => g.label_key === key)?.id;
      const hit = groupId ? lists.find((l) => l.group_id === groupId)?.clickup_list_id : null;
      if (hit) return hit;
    }
  }

  const { data: settingsRow } = await sb
    .from("settings")
    .select("clickup_internal_list_id")
    .eq("id", 1)
    .maybeSingle();
  return (settingsRow as { clickup_internal_list_id: string | null } | null)?.clickup_internal_list_id ?? null;
}

async function syncClickupCreate(req: Request, ctx: ClickupSyncCreateCtx): Promise<ClickupSyncResult> {
  const listId = await resolveMeetingListId(ctx.sb, ctx.client.id);
  if (!listId) {
    return { taskId: null, taskUrl: null, error: NO_CLICKUP_LIST_ERROR };
  }
  const { token: pat } = await getOperatorClickupToken(req);
  if (!pat) {
    return { taskId: null, taskUrl: null, error: "No ClickUp token available (CLICKUP_PAT secret not set)." };
  }
  const CU = { headers: { Authorization: pat, "Content-Type": "application/json" } };
  const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, CU);
  if (!fieldsRes.ok) {
    return { taskId: null, taskUrl: null, error: `ClickUp fields ${fieldsRes.status}: ${await fieldsRes.text()}` };
  }
  const cuFields = ((await fieldsRes.json()).fields ?? []) as CuField[];

  const clickupClientName = ctx.client.clickup_client_name ?? ctx.client.name;
  const description = buildMeetingDescription({
    title: ctx.meeting.title,
    agenda: ctx.meeting.agenda,
    clientName: ctx.client.name,
    projectName: ctx.project?.name ?? null,
    attendeeNames: ctx.attendees.map((a) => a.full_name),
    meetUrl: ctx.meetUrl,
    meetingId: ctx.meeting.id,
  });
  const assignees = ctx.attendees
    .map((a) => a.clickup_user_id)
    .filter((id): id is number => typeof id === "number");
  const startsAtMs = Date.parse(ctx.meeting.starts_at);
  const endsAtMs = Date.parse(ctx.meeting.ends_at);
  const points = meetingSprintPoints(ctx.meeting.starts_at, ctx.meeting.ends_at);

  const taskBody: Record<string, unknown> = {
    name: buildMeetingTaskName(clickupClientName, ctx.meeting.title),
    ...nativeMeetingTaskBody({ description, startsAtMs, endsAtMs, points }),
    // Deliberately OMIT `status` — a hardcoded status fails with CRTSK_001 on
    // lists (like the internal one) whose default status isn't "to do".
    custom_fields: meetingCustomFields(cuFields, clickupClientName, ctx.project?.clickup_work_stream_override ?? null),
  };
  if (assignees.length > 0) taskBody.assignees = assignees;

  const createUrl = `https://api.clickup.com/api/v2/list/${listId}/task`;
  let createRes = await fetch(createUrl, { ...CU, method: "POST", body: JSON.stringify(taskBody) });
  // ClickUp rejects very large sprint-point values on create; retry once
  // without `points` rather than fail the task (time_estimate still carries
  // the effort).
  if (!createRes.ok && "points" in taskBody) {
    const errText = await createRes.text();
    console.warn(
      `[manage-internal-meeting] ClickUp create failed with points (${createRes.status}: ${errText}); retrying without points`,
    );
    const { points: _dropped, ...noPoints } = taskBody;
    createRes = await fetch(createUrl, { ...CU, method: "POST", body: JSON.stringify(noPoints) });
  }
  if (!createRes.ok) {
    return { taskId: null, taskUrl: null, error: `ClickUp create ${createRes.status}: ${await createRes.text()}` };
  }
  const created = (await createRes.json()) as { id: string; url: string };
  return { taskId: created.id, taskUrl: created.url, error: null };
}

interface ClickupSyncUpdateCtx extends ClickupSyncCreateCtx {
  /** True only when the caller's request explicitly changed attendee_member_ids. */
  attendeesChanged: boolean;
}

/** GET the task's current assignees and diff against the desired set. Returns
 * null (rather than throwing) if the GET fails, so the caller can skip the
 * assignee update without failing the whole sync. */
async function resolveAssigneeDiff(
  pat: string,
  taskId: string,
  desiredIds: number[],
): Promise<{ add: number[]; rem: number[] } | null> {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: { Authorization: pat, "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  const task = (await res.json()) as { assignees?: Array<{ id: number }> };
  const currentIds = (task.assignees ?? []).map((a) => a.id);
  return {
    add: desiredIds.filter((id) => !currentIds.includes(id)),
    rem: currentIds.filter((id) => !desiredIds.includes(id)),
  };
}

async function syncClickupUpdate(req: Request, ctx: ClickupSyncUpdateCtx): Promise<ClickupSyncResult> {
  const taskId = ctx.meeting.clickup_task_id;
  if (!taskId) {
    // Never synced before (list wasn't configured, or a prior failure) —
    // attempt the create now so fixing the config later self-heals.
    return syncClickupCreate(req, ctx);
  }

  const { token: pat } = await getOperatorClickupToken(req);
  if (!pat) {
    return { taskId, taskUrl: ctx.meeting.clickup_task_url, error: "No ClickUp token available (CLICKUP_PAT secret not set)." };
  }
  const CU = { headers: { Authorization: pat, "Content-Type": "application/json" } };

  const clickupClientName = ctx.client.clickup_client_name ?? ctx.client.name;
  const description = buildMeetingDescription({
    title: ctx.meeting.title,
    agenda: ctx.meeting.agenda,
    clientName: ctx.client.name,
    projectName: ctx.project?.name ?? null,
    attendeeNames: ctx.attendees.map((a) => a.full_name),
    meetUrl: ctx.meetUrl,
    meetingId: ctx.meeting.id,
  });
  const startsAtMs = Date.parse(ctx.meeting.starts_at);
  const endsAtMs = Date.parse(ctx.meeting.ends_at);
  const points = meetingSprintPoints(ctx.meeting.starts_at, ctx.meeting.ends_at);

  const putBody: Record<string, unknown> = {
    name: buildMeetingTaskName(clickupClientName, ctx.meeting.title),
    ...nativeMeetingTaskBody({ description, startsAtMs, endsAtMs, points }),
  };

  if (ctx.attendeesChanged) {
    const desired = ctx.attendees
      .map((a) => a.clickup_user_id)
      .filter((id): id is number => typeof id === "number");
    const diff = await resolveAssigneeDiff(pat, taskId, desired);
    if (!diff) {
      console.warn(`[manage-internal-meeting] could not read current ClickUp assignees for task ${taskId}; leaving assignees unchanged`);
    } else if (diff.add.length > 0 || diff.rem.length > 0) {
      putBody.assignees = diff;
    }
  }

  const putRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    ...CU,
    method: "PUT",
    body: JSON.stringify(putBody),
  });
  if (!putRes.ok) {
    return { taskId, taskUrl: ctx.meeting.clickup_task_url, error: `ClickUp update ${putRes.status}: ${await putRes.text()}` };
  }

  // Dropdown custom fields aren't settable via the general task PUT — each
  // needs its own POST to /task/{id}/field/{field_id}. Client/work stream can
  // change on an edit, so refresh them (best-effort; never fails the update).
  // The list id is only needed for this field-definitions lookup — the PUT
  // above already addresses the task directly, so it must not be gated on
  // the internal list still being configured (an edit to an already-synced
  // task should keep working even if the client's lists are later remapped).
  const listId = await resolveMeetingListId(ctx.sb, ctx.client.id);
  const fieldsRes = listId ? await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, CU) : null;
  if (fieldsRes?.ok) {
    const cuFields = ((await fieldsRes.json()).fields ?? []) as CuField[];
    const customFields = meetingCustomFields(cuFields, clickupClientName, ctx.project?.clickup_work_stream_override ?? null);
    await Promise.all(
      customFields.map(async (cf) => {
        const r = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${cf.id}`, {
          ...CU,
          method: "POST",
          body: JSON.stringify({ value: cf.value }),
        });
        if (!r.ok) console.warn(`[manage-internal-meeting] custom field ${cf.id} update failed for task ${taskId}: ${r.status}`);
      }),
    );
  } else if (fieldsRes) {
    console.warn(`[manage-internal-meeting] could not refresh ClickUp field defs for list ${listId}: ${fieldsRes.status}`);
  } else {
    console.warn(`[manage-internal-meeting] no ClickUp list resolved for client ${ctx.client.id} — skipping custom-field refresh for task ${taskId}`);
  }

  return { taskId, taskUrl: ctx.meeting.clickup_task_url, error: null };
}

// ── Caller auth ──────────────────────────────────────────────────────────
//
// Deployed with --no-verify-jwt (same posture as google-token), so this is
// the ONLY authn/authz gate — the service-role client below bypasses RLS
// entirely, meaning migration 0093's organiser-vs-attendee policies are
// never consulted on this write path.

interface Caller {
  /** null under the shared team@convertedclick.co.za login (no team_members row). */
  memberId: string | null;
  role: string;
}

const SHARED_DEV_EMAIL = "team@convertedclick.co.za";

async function resolveCaller(req: Request, sb: SupabaseClient): Promise<Caller | { error: string }> {
  try {
    const userClient = createUserClient(req);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user?.email) {
      return { error: "Could not resolve the signed-in user." };
    }
    const email = userData.user.email;
    const { data: member } = await sb.from("team_members").select("id, role").eq("email", email).maybeSingle();
    if (member) {
      const m = member as { id: string; role: string };
      return { memberId: m.id, role: m.role };
    }
    // Shared dev/admin login has no team_members row — treated as owner for
    // ergonomics, mirroring the current_team_member_role() SQL fallback.
    if (email === SHARED_DEV_EMAIL) return { memberId: null, role: "owner" };
    return { error: `No team_members row for ${email}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error resolving caller." };
  }
}

function isPrivileged(caller: Caller): boolean {
  return caller.role === "admin" || caller.role === "owner";
}

// ── Action handlers ─────────────────────────────────────────────────────

async function loadClient(sb: SupabaseClient, clientId: string): Promise<ClientRow | null> {
  const { data } = await sb.from("clients").select("id, name, clickup_client_name").eq("id", clientId).maybeSingle();
  return (data as ClientRow | null) ?? null;
}

async function loadProject(sb: SupabaseClient, projectId: string): Promise<ProjectRow | null> {
  const { data } = await sb
    .from("projects")
    .select("id, name, clickup_work_stream_override")
    .eq("id", projectId)
    .maybeSingle();
  return (data as ProjectRow | null) ?? null;
}

async function loadTeamMembers(sb: SupabaseClient, ids: string[]): Promise<TeamMember[]> {
  if (ids.length === 0) return [];
  const { data } = await sb.from("team_members").select("id, full_name, email, clickup_user_id").in("id", ids);
  return (data as TeamMember[] | null) ?? [];
}

async function handleCreate(req: Request, sb: SupabaseClient, caller: Caller, body: CreateBody): Promise<Response> {
  const title = body.title?.trim();
  if (!title) return json({ error: "title is required" }, 400);
  if (!body.organiser_member_id) return json({ error: "organiser_member_id is required" }, 400);
  if (!isPrivileged(caller) && body.organiser_member_id !== caller.memberId) {
    return json({ error: "You can only create meetings organised by yourself." }, 403);
  }
  if (!body.client_id) return json({ error: "client_id is required" }, 400);
  if (!body.starts_at || !body.ends_at) return json({ error: "starts_at and ends_at are required" }, 400);
  const startsMs = Date.parse(body.starts_at);
  const endsMs = Date.parse(body.ends_at);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
    return json({ error: "starts_at/ends_at must be valid timestamps" }, 400);
  }
  if (endsMs <= startsMs) return json({ error: "ends_at must be after starts_at" }, 400);
  const attendeeIds = Array.from(new Set((body.attendee_member_ids ?? []).filter(Boolean)));
  if (attendeeIds.length === 0) return json({ error: "At least one attendee is required" }, 400);

  const [organiser] = await loadTeamMembers(sb, [body.organiser_member_id]);
  if (!organiser) return json({ error: "organiser_member_id not found" }, 400);
  const client = await loadClient(sb, body.client_id);
  if (!client) return json({ error: "client_id not found" }, 400);
  const project = body.project_id ? await loadProject(sb, body.project_id) : null;
  if (body.project_id && !project) return json({ error: "project_id not found" }, 400);
  const attendees = await loadTeamMembers(sb, attendeeIds);
  if (attendees.length !== attendeeIds.length) return json({ error: "one or more attendee_member_ids not found" }, 400);

  // DB row FIRST, before any external call.
  const { data: inserted, error: insErr } = await sb
    .from("internal_meetings")
    .insert({
      organiser_id: organiser.id,
      client_id: client.id,
      project_id: project?.id ?? null,
      title,
      agenda: body.agenda?.trim() || null,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      status: "scheduled",
    })
    .select("*")
    .single();
  if (insErr || !inserted) {
    return json({ error: `Failed to create meeting: ${insErr?.message ?? "unknown error"}` }, 500);
  }
  const meeting = inserted as MeetingRow;

  const { error: attErr } = await sb
    .from("internal_meeting_attendees")
    .insert(attendeeIds.map((team_member_id) => ({ meeting_id: meeting.id, team_member_id })));
  if (attErr) {
    console.error(`[manage-internal-meeting] attendee insert failed for meeting ${meeting.id}: ${attErr.message}`);
  }

  const googleResult = await safeGoogleSync(
    () => syncGoogleCreate(req, { meeting, organiser, client, project, attendees }),
    { eventId: null, googleEmail: null, meetUrl: null, htmlLink: null },
  );
  const clickupResult = await safeClickupSync(
    () => syncClickupCreate(req, { sb, meeting, client, project, attendees, meetUrl: googleResult.meetUrl }),
    { taskId: null, taskUrl: null },
  );

  const { error: syncUpdErr } = await sb
    .from("internal_meetings")
    .update({
      google_event_id: googleResult.eventId,
      google_calendar_email: googleResult.googleEmail,
      google_meet_url: googleResult.meetUrl,
      google_html_link: googleResult.htmlLink,
      google_sync_error: googleResult.error,
      clickup_task_id: clickupResult.taskId,
      clickup_task_url: clickupResult.taskUrl,
      clickup_sync_error: clickupResult.error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", meeting.id);
  if (syncUpdErr) {
    console.error(`[manage-internal-meeting] failed to persist sync results for meeting ${meeting.id}: ${syncUpdErr.message}`);
  }

  return json({
    meeting_id: meeting.id,
    google_meet_url: googleResult.meetUrl,
    google_html_link: googleResult.htmlLink,
    clickup_task_url: clickupResult.taskUrl,
    ...(googleResult.error ? { google_sync_error: googleResult.error } : {}),
    ...(clickupResult.error ? { clickup_sync_error: clickupResult.error } : {}),
  });
}

async function handleUpdate(req: Request, sb: SupabaseClient, caller: Caller, body: UpdateBody): Promise<Response> {
  if (!body.meeting_id) return json({ error: "meeting_id is required" }, 400);
  const { data: existing, error: fetchErr } = await sb
    .from("internal_meetings")
    .select("*")
    .eq("id", body.meeting_id)
    .maybeSingle();
  if (fetchErr || !existing) return json({ error: "Meeting not found" }, 404);
  const current = existing as MeetingRow;
  if (!isPrivileged(caller) && current.organiser_id !== caller.memberId) {
    return json({ error: "Only the organiser can update this meeting." }, 403);
  }
  if (current.status === "cancelled") return json({ error: "Cannot update a cancelled meeting" }, 400);

  const title = body.title !== undefined ? body.title.trim() : current.title;
  if (!title) return json({ error: "title cannot be empty" }, 400);
  const agenda = body.agenda !== undefined ? (body.agenda?.trim() || null) : current.agenda;
  const clientId = body.client_id !== undefined ? body.client_id : current.client_id;
  if (!clientId) return json({ error: "client_id is required" }, 400);
  const projectId = body.project_id !== undefined ? body.project_id : current.project_id;
  const startsAt = body.starts_at !== undefined ? body.starts_at : current.starts_at;
  const endsAt = body.ends_at !== undefined ? body.ends_at : current.ends_at;
  const startsMs = Date.parse(startsAt);
  const endsMs = Date.parse(endsAt);
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
    return json({ error: "starts_at/ends_at must be valid timestamps" }, 400);
  }
  if (endsMs <= startsMs) return json({ error: "ends_at must be after starts_at" }, 400);

  const attendeesChanged = body.attendee_member_ids !== undefined;
  let attendeeIds: string[];
  if (attendeesChanged) {
    attendeeIds = Array.from(new Set((body.attendee_member_ids ?? []).filter(Boolean)));
  } else {
    const { data: existingAttendees } = await sb
      .from("internal_meeting_attendees")
      .select("team_member_id")
      .eq("meeting_id", current.id);
    attendeeIds = ((existingAttendees as Array<{ team_member_id: string }> | null) ?? []).map((r) => r.team_member_id);
  }
  if (attendeeIds.length === 0) return json({ error: "At least one attendee is required" }, 400);

  const [organiser] = await loadTeamMembers(sb, [current.organiser_id]);
  if (!organiser) return json({ error: "Meeting organiser no longer exists" }, 500);
  const client = await loadClient(sb, clientId);
  if (!client) return json({ error: "client_id not found" }, 400);
  const project = projectId ? await loadProject(sb, projectId) : null;
  if (projectId && !project) return json({ error: "project_id not found" }, 400);
  const attendees = await loadTeamMembers(sb, attendeeIds);
  if (attendees.length !== attendeeIds.length) return json({ error: "one or more attendee_member_ids not found" }, 400);

  // DB row first: persist the validated new values before any external sync.
  const { error: updErr } = await sb
    .from("internal_meetings")
    .update({
      title, agenda, client_id: clientId, project_id: projectId, starts_at: startsAt, ends_at: endsAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id);
  if (updErr) return json({ error: `Failed to update meeting: ${updErr.message}` }, 500);

  if (attendeesChanged) {
    await sb.from("internal_meeting_attendees").delete().eq("meeting_id", current.id);
    const { error: attInsErr } = await sb
      .from("internal_meeting_attendees")
      .insert(attendeeIds.map((team_member_id) => ({ meeting_id: current.id, team_member_id })));
    if (attInsErr) {
      console.error(`[manage-internal-meeting] attendee re-insert failed for meeting ${current.id}: ${attInsErr.message}`);
    }
  }

  const meeting: MeetingRow = { ...current, title, agenda, client_id: clientId, project_id: projectId, starts_at: startsAt, ends_at: endsAt };

  const googleResult = await safeGoogleSync(
    () => syncGoogleUpdate(req, { meeting, organiser, client, project, attendees, attendeesChanged }),
    {
      eventId: meeting.google_event_id,
      googleEmail: meeting.google_calendar_email,
      meetUrl: meeting.google_meet_url,
      htmlLink: meeting.google_html_link,
    },
  );
  const clickupResult = await safeClickupSync(
    () =>
      syncClickupUpdate(req, {
        sb, meeting, client, project, attendees, meetUrl: googleResult.meetUrl, attendeesChanged,
      }),
    { taskId: meeting.clickup_task_id, taskUrl: meeting.clickup_task_url },
  );

  const { error: syncUpdErr } = await sb
    .from("internal_meetings")
    .update({
      google_event_id: googleResult.eventId,
      google_calendar_email: googleResult.googleEmail,
      google_meet_url: googleResult.meetUrl,
      google_html_link: googleResult.htmlLink,
      google_sync_error: googleResult.error,
      clickup_task_id: clickupResult.taskId,
      clickup_task_url: clickupResult.taskUrl,
      clickup_sync_error: clickupResult.error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id);
  if (syncUpdErr) {
    console.error(`[manage-internal-meeting] failed to persist sync results for meeting ${current.id}: ${syncUpdErr.message}`);
  }

  return json({
    meeting_id: current.id,
    google_meet_url: googleResult.meetUrl,
    clickup_task_url: clickupResult.taskUrl,
    ...(googleResult.error ? { google_sync_error: googleResult.error } : {}),
    ...(clickupResult.error ? { clickup_sync_error: clickupResult.error } : {}),
  });
}

async function handleCancel(req: Request, sb: SupabaseClient, caller: Caller, body: CancelBody): Promise<Response> {
  if (!body.meeting_id) return json({ error: "meeting_id is required" }, 400);
  const { data: existing, error: fetchErr } = await sb
    .from("internal_meetings")
    .select("*")
    .eq("id", body.meeting_id)
    .maybeSingle();
  if (fetchErr || !existing) return json({ error: "Meeting not found" }, 404);
  const meeting = existing as MeetingRow;
  if (!isPrivileged(caller) && meeting.organiser_id !== caller.memberId) {
    return json({ error: "Only the organiser can cancel this meeting." }, 403);
  }
  if (meeting.status === "cancelled") return json({ ok: true }); // idempotent

  // Row is the source of truth: mark cancelled FIRST. A Google/ClickUp
  // failure below must not resurrect the meeting or block cancellation.
  const { error: cancelErr } = await sb
    .from("internal_meetings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", meeting.id);
  if (cancelErr) return json({ error: `Failed to cancel meeting: ${cancelErr.message}` }, 500);

  // Cancellation already committed above (status='cancelled'); everything
  // from here is best-effort cleanup — a thrown fetch must not turn into an
  // uncaught error that makes the caller think the cancel itself failed.
  let googleError: string | null = null;
  if (meeting.google_event_id) {
    try {
      if (!meeting.google_calendar_email) {
        googleError = "Meeting has a Google event but no recorded calendar account — the calendar invite could not be removed automatically.";
      } else {
        const resolved = await getGoogleAccessToken(req, { googleEmail: meeting.google_calendar_email });
        if (!resolved.accessToken) {
          googleError = resolved.error ??
            `No Google account connected for ${meeting.google_calendar_email} — the calendar invite could not be removed automatically.`;
        } else {
          const result = await deleteEvent(resolved.accessToken, meeting.google_event_id);
          if (!result.ok) googleError = result.error;
        }
      }
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
    }
  }

  let clickupError: string | null = null;
  if (meeting.clickup_task_id) {
    try {
      const { token: pat } = await getOperatorClickupToken(req);
      if (!pat) {
        clickupError = "No ClickUp token available (CLICKUP_PAT secret not set).";
      } else {
        const res = await fetch(`https://api.clickup.com/api/v2/task/${meeting.clickup_task_id}`, {
          method: "DELETE",
          headers: { Authorization: pat, "Content-Type": "application/json" },
        });
        if (!res.ok && res.status !== 404) {
          clickupError = `ClickUp delete ${res.status}: ${await res.text()}`;
        }
      }
    } catch (e) {
      clickupError = e instanceof Error ? e.message : String(e);
    }
  }

  const { error: syncUpdErr } = await sb
    .from("internal_meetings")
    .update({ google_sync_error: googleError, clickup_sync_error: clickupError, updated_at: new Date().toISOString() })
    .eq("id", meeting.id);
  if (syncUpdErr) {
    console.error(`[manage-internal-meeting] failed to persist cancel sync results for meeting ${meeting.id}: ${syncUpdErr.message}`);
  }

  return json({
    ok: true,
    ...(googleError ? { google_sync_error: googleError } : {}),
    ...(clickupError ? { clickup_sync_error: clickupError } : {}),
  });
}

// ── Entry point ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as ActionBody;
    const sb = createServiceRoleClient();
    const caller = await resolveCaller(req, sb);
    if ("error" in caller) return json({ error: caller.error }, 401);
    switch (body.action) {
      case "create":
        return await handleCreate(req, sb, caller, body);
      case "update":
        return await handleUpdate(req, sb, caller, body);
      case "cancel":
        return await handleCancel(req, sb, caller, body);
      default:
        return json({ error: "action must be one of: create, update, cancel" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
