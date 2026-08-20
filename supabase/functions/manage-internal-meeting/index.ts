// supabase/functions/manage-internal-meeting/index.ts
//
// Request:  POST { action: "create", organiser_member_id, client_id, project_id?,
//                   title, agenda?, starts_at, ends_at, attendee_member_ids: string[],
//                   work_stream_override?, clickup_status_override? }
//           → 200 { meeting_id, google_meet_url, google_html_link, clickup_task_url,
//                    google_sync_error?, clickup_sync_error? }
//
//           POST { action: "update", meeting_id, title?, agenda?, client_id?,
//                   project_id?, starts_at?, ends_at?, attendee_member_ids?,
//                   work_stream_override?, clickup_status_override? }
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
// ClickUp is synced BEFORE Google (both on create and update) so every
// attendee's own task URL is known in time to include in the Calendar invite
// description (each attendee gets their own task — see
// 0099_internal_meeting_tasks).
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
import {
  createMeetingTask,
  fetchListFields,
  meetingCustomFields,
  nativeMeetingTaskBody,
  NO_CLICKUP_LIST_ERROR,
  resolveMeetingListId,
} from "../_shared/meeting-clickup.ts";
import { postChatMessage, mentionToken, MEETINGS_CHANNEL_ID } from "../_shared/clickup-chat.ts";
import {
  buildMeetingDescription,
  buildMeetingTaskName,
  extractMeetUrl,
  meetingScheduledMessage,
  meetingSprintPoints,
  type MeetingTaskLink,
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
  work_stream_override: string | null;
  clickup_status_override: string | null;
  source: string;
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
  work_stream_override?: string | null;
  clickup_status_override?: string | null;
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
  work_stream_override?: string | null;
  clickup_status_override?: string | null;
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
  /** Every person's own task link (name + url) — the organiser's task alone
   * (taskId/taskUrl above) isn't enough once each attendee has their own. */
  personTaskLinks: MeetingTaskLink[];
}
/** One person's ClickUp task outcome (create or update) within a meeting sync. */
interface PersonTaskResult {
  teamMemberId: string;
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
  fallback: Pick<ClickupSyncResult, "taskId" | "taskUrl" | "personTaskLinks">,
): Promise<ClickupSyncResult> {
  try {
    return await fn();
  } catch (e) {
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A meeting discovered on someone's calendar is not ours to change. The
 * Google event belongs to whoever sent the invite — patching it would edit a
 * client's event on their calendar, and deleting it would cancel their
 * meeting for everyone. Edit or cancel those in Google Calendar; the next
 * sync brings the change back.
 */
const CALENDAR_SOURCED_ERROR =
  "This meeting came from Google Calendar, not Conductor. Change it in Google Calendar — the next sync will pick it up.";

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
  /** Every person's ClickUp task link, when already known (ClickUp is
   * synced BEFORE Google — see handleCreate/handleUpdate) — included in the
   * invite description so each attendee can find their own task. */
  clickupTaskLinks: MeetingTaskLink[];
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
    clickupTaskLinks: ctx.clickupTaskLinks,
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
    clickupTaskLinks: ctx.clickupTaskLinks,
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
  organiser: TeamMember;
  attendees: TeamMember[];
  meetUrl: string | null;
}

async function syncClickupCreate(req: Request, ctx: ClickupSyncCreateCtx): Promise<ClickupSyncResult> {
  const listId = await resolveMeetingListId(ctx.sb, ctx.client.id);
  if (!listId) {
    return { taskId: null, taskUrl: null, personTaskLinks: [], error: NO_CLICKUP_LIST_ERROR };
  }
  const { token: pat } = await getOperatorClickupToken(req);
  if (!pat) {
    return { taskId: null, taskUrl: null, personTaskLinks: [], error: "No ClickUp token available (CLICKUP_PAT secret not set)." };
  }
  const cuFields = await fetchListFields(pat, listId);

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
  const taskName = buildMeetingTaskName(clickupClientName, ctx.meeting.title);
  // Staff pick on the meeting takes priority over the linked project's
  // override; status stays unset (list default) unless staff explicitly
  // picked one — see nativeMeetingTaskBody's CRTSK_001 note.
  const workStream = ctx.meeting.work_stream_override ?? ctx.project?.clickup_work_stream_override ?? null;
  const customFields = meetingCustomFields(cuFields, clickupClientName, workStream);

  // ClickUp splits Sprint Points PER ASSIGNEE on a shared task (confirmed
  // empirically: a 2pt task with two assignees credited only one of them).
  // So each person gets their OWN task with the full points, not co-assigned
  // to one shared task. De-dup by id in case the organiser is also listed as
  // an attendee.
  const people = Array.from(new Map([ctx.organiser, ...ctx.attendees].map((p) => [p.id, p])).values());

  const results: PersonTaskResult[] = [];
  for (const person of people) {
    const created = await createMeetingTask(pat, listId, {
      name: taskName,
      body: nativeMeetingTaskBody({
        description, startsAtMs, endsAtMs, points,
        statusOverride: ctx.meeting.clickup_status_override,
      }),
      customFields,
      clickupUserId: person.clickup_user_id,
      label: person.full_name,
    });
    results.push({ teamMemberId: person.id, ...created });
  }

  const { error: upsertErr } = await ctx.sb.from("internal_meeting_tasks").upsert(
    results.map((r) => ({
      meeting_id: ctx.meeting.id,
      team_member_id: r.teamMemberId,
      clickup_task_id: r.taskId,
      clickup_task_url: r.taskUrl,
      clickup_sync_error: r.error,
    })),
    { onConflict: "meeting_id,team_member_id" },
  );
  if (upsertErr) {
    console.error(`[manage-internal-meeting] failed to persist per-person meeting tasks for ${ctx.meeting.id}: ${upsertErr.message}`);
  }

  // One chat message for the whole meeting (not one per task, to avoid
  // spamming the channel) — mentions everyone, links each person's OWN task.
  // Posted to the workspace-wide Meetings channel, not the client's own
  // channel — clients aren't members of it, so nothing internal leaks.
  const personTaskLinks: MeetingTaskLink[] = results
    .filter((r): r is PersonTaskResult & { taskUrl: string } => !!r.taskUrl)
    .map((r) => ({
      name: people.find((p) => p.id === r.teamMemberId)?.full_name ?? r.teamMemberId,
      url: r.taskUrl,
    }));
  const chatContent = meetingScheduledMessage({
    people: people.map((p) => ({
      mention: mentionToken({ clickupUserId: p.clickup_user_id, name: p.full_name }),
      taskUrl: results.find((r) => r.teamMemberId === p.id)?.taskUrl ?? null,
    })),
    title: ctx.meeting.title,
  });
  if (personTaskLinks.length > 0) {
    await postChatMessage(pat, MEETINGS_CHANNEL_ID, chatContent);
  }

  const organiserResult = results.find((r) => r.teamMemberId === ctx.organiser.id);
  const failed = results.filter((r) => r.error);
  const aggregateError = failed.length > 0
    ? `Some meeting tasks failed: ${failed.map((f) => {
        const person = people.find((p) => p.id === f.teamMemberId);
        return `${person?.full_name ?? f.teamMemberId}: ${f.error}`;
      }).join("; ")}`
    : null;

  return {
    taskId: organiserResult?.taskId ?? null,
    taskUrl: organiserResult?.taskUrl ?? null,
    personTaskLinks,
    error: aggregateError,
  };
}

interface ClickupSyncUpdateCtx extends ClickupSyncCreateCtx {
  /** True only when the caller's request explicitly changed attendee_member_ids. */
  attendeesChanged: boolean;
}

async function syncClickupUpdate(req: Request, ctx: ClickupSyncUpdateCtx): Promise<ClickupSyncResult> {
  if (!ctx.meeting.clickup_task_id) {
    // Never synced before (list wasn't configured, or a prior failure) —
    // attempt the create now so fixing the config later self-heals.
    return syncClickupCreate(req, ctx);
  }

  const { token: pat } = await getOperatorClickupToken(req);
  if (!pat) {
    return { taskId: ctx.meeting.clickup_task_id, taskUrl: ctx.meeting.clickup_task_url, personTaskLinks: [], error: "No ClickUp token available (CLICKUP_PAT secret not set)." };
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
  const taskName = buildMeetingTaskName(clickupClientName, ctx.meeting.title);

  // Field defs are needed both to refresh dropdown custom fields on existing
  // tasks and to build new ones for newly-added attendees — resolve once.
  // Not gated on the internal list still being configured: an edit to
  // already-synced tasks must keep working even if lists are later remapped.
  const listId = await resolveMeetingListId(ctx.sb, ctx.client.id);
  if (!listId) {
    console.warn(`[manage-internal-meeting] no ClickUp list resolved for client ${ctx.client.id} — skipping custom-field refresh`);
  }
  const cuFields = listId ? await fetchListFields(pat, listId) : [];
  const workStream = ctx.meeting.work_stream_override ?? ctx.project?.clickup_work_stream_override ?? null;
  const customFields = meetingCustomFields(cuFields, clickupClientName, workStream);

  const people = Array.from(new Map([ctx.organiser, ...ctx.attendees].map((p) => [p.id, p])).values());
  const { data: existingRows } = await ctx.sb
    .from("internal_meeting_tasks")
    .select("team_member_id, clickup_task_id, clickup_task_url")
    .eq("meeting_id", ctx.meeting.id);
  const existingByMember = new Map(
    ((existingRows ?? []) as Array<{ team_member_id: string; clickup_task_id: string | null; clickup_task_url: string | null }>)
      .map((r) => [r.team_member_id, r]),
  );

  const results: PersonTaskResult[] = [];
  for (const person of people) {
    const existing = existingByMember.get(person.id);
    const existingTaskId = existing?.clickup_task_id ?? null;
    if (!existingTaskId) {
      // New attendee since last sync — create their task from scratch.
      if (!listId) {
        results.push({ teamMemberId: person.id, taskId: null, taskUrl: null, error: NO_CLICKUP_LIST_ERROR });
        continue;
      }
      const created = await createMeetingTask(pat, listId, {
        name: taskName,
        body: nativeMeetingTaskBody({
          description, startsAtMs, endsAtMs, points,
          statusOverride: ctx.meeting.clickup_status_override,
        }),
        customFields,
        clickupUserId: person.clickup_user_id,
        label: person.full_name,
      });
      results.push({ teamMemberId: person.id, ...created });
      continue;
    }

    const putBody: Record<string, unknown> = {
      name: taskName,
      ...nativeMeetingTaskBody({
        description, startsAtMs, endsAtMs, points,
        statusOverride: ctx.meeting.clickup_status_override,
      }),
    };
    const putRes = await fetch(`https://api.clickup.com/api/v2/task/${existingTaskId}`, {
      ...CU, method: "PUT", body: JSON.stringify(putBody),
    });
    if (!putRes.ok) {
      results.push({ teamMemberId: person.id, taskId: existingTaskId, taskUrl: existing?.clickup_task_url ?? null, error: `ClickUp update ${putRes.status}: ${await putRes.text()}` });
      continue;
    }
    // Dropdown custom fields aren't settable via the general task PUT — each
    // needs its own POST to /task/{id}/field/{field_id}.
    await Promise.all(
      customFields.map(async (cf) => {
        const r = await fetch(`https://api.clickup.com/api/v2/task/${existingTaskId}/field/${cf.id}`, {
          ...CU, method: "POST", body: JSON.stringify({ value: cf.value }),
        });
        if (!r.ok) console.warn(`[manage-internal-meeting] custom field ${cf.id} update failed for task ${existingTaskId}: ${r.status}`);
      }),
    );
    results.push({ teamMemberId: person.id, taskId: existingTaskId, taskUrl: existing?.clickup_task_url ?? null, error: null });
  }

  const { error: upsertErr } = await ctx.sb.from("internal_meeting_tasks").upsert(
    results.map((r) => ({
      meeting_id: ctx.meeting.id,
      team_member_id: r.teamMemberId,
      clickup_task_id: r.taskId,
      clickup_task_url: r.taskUrl,
      clickup_sync_error: r.error,
    })),
    { onConflict: "meeting_id,team_member_id" },
  );
  if (upsertErr) {
    console.error(`[manage-internal-meeting] failed to persist per-person meeting task updates for ${ctx.meeting.id}: ${upsertErr.message}`);
  }

  const organiserResult = results.find((r) => r.teamMemberId === ctx.organiser.id);
  const personTaskLinks: MeetingTaskLink[] = results
    .filter((r): r is PersonTaskResult & { taskUrl: string } => !!r.taskUrl)
    .map((r) => ({
      name: people.find((p) => p.id === r.teamMemberId)?.full_name ?? r.teamMemberId,
      url: r.taskUrl,
    }));
  const failed = results.filter((r) => r.error);
  const aggregateError = failed.length > 0
    ? `Some meeting tasks failed: ${failed.map((f) => {
        const person = people.find((p) => p.id === f.teamMemberId);
        return `${person?.full_name ?? f.teamMemberId}: ${f.error}`;
      }).join("; ")}`
    : null;

  return {
    taskId: organiserResult?.taskId ?? ctx.meeting.clickup_task_id,
    taskUrl: organiserResult?.taskUrl ?? ctx.meeting.clickup_task_url,
    personTaskLinks,
    error: aggregateError,
  };
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
  const { data } = await sb
    .from("clients")
    .select("id, name, clickup_client_name")
    .eq("id", clientId)
    .maybeSingle();
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
      work_stream_override: body.work_stream_override?.trim() || null,
      clickup_status_override: body.clickup_status_override?.trim() || null,
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

  // ClickUp BEFORE Google: the calendar invite links back to everyone's own
  // task, so those URLs must exist first. The ClickUp tasks' own descriptions
  // won't have the Meet link until the next edit (self-heals then, like
  // every other field in this file) — a one-edit lag, not a lost link.
  const clickupResult = await safeClickupSync(
    () => syncClickupCreate(req, { sb, meeting, client, project, organiser, attendees, meetUrl: null }),
    { taskId: null, taskUrl: null, personTaskLinks: [] },
  );
  const googleResult = await safeGoogleSync(
    () => syncGoogleCreate(req, { meeting, organiser, client, project, attendees, clickupTaskLinks: clickupResult.personTaskLinks }),
    { eventId: null, googleEmail: null, meetUrl: null, htmlLink: null },
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
  if (current.source === "calendar") return json({ error: CALENDAR_SOURCED_ERROR }, 400);

  const title = body.title !== undefined ? body.title.trim() : current.title;
  if (!title) return json({ error: "title cannot be empty" }, 400);
  const agenda = body.agenda !== undefined ? (body.agenda?.trim() || null) : current.agenda;
  const clientId = body.client_id !== undefined ? body.client_id : current.client_id;
  if (!clientId) return json({ error: "client_id is required" }, 400);
  const projectId = body.project_id !== undefined ? body.project_id : current.project_id;
  const startsAt = body.starts_at !== undefined ? body.starts_at : current.starts_at;
  const endsAt = body.ends_at !== undefined ? body.ends_at : current.ends_at;
  const workStreamOverride = body.work_stream_override !== undefined
    ? (body.work_stream_override?.trim() || null)
    : current.work_stream_override;
  const clickupStatusOverride = body.clickup_status_override !== undefined
    ? (body.clickup_status_override?.trim() || null)
    : current.clickup_status_override;
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
      work_stream_override: workStreamOverride, clickup_status_override: clickupStatusOverride,
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

  const meeting: MeetingRow = {
    ...current, title, agenda, client_id: clientId, project_id: projectId, starts_at: startsAt, ends_at: endsAt,
    work_stream_override: workStreamOverride, clickup_status_override: clickupStatusOverride,
  };

  // ClickUp BEFORE Google, same reasoning as handleCreate: the invite
  // description needs everyone's (possibly just-created-on-self-heal) task
  // links. If the whole sync throws, fall back to just the organiser's
  // previously-stored link rather than nothing — a best-effort degrade, not
  // a full per-person history lookup.
  const clickupResult = await safeClickupSync(
    () =>
      syncClickupUpdate(req, {
        sb, meeting, client, project, organiser, attendees, meetUrl: meeting.google_meet_url, attendeesChanged,
      }),
    {
      taskId: meeting.clickup_task_id,
      taskUrl: meeting.clickup_task_url,
      personTaskLinks: meeting.clickup_task_url ? [{ name: organiser.full_name, url: meeting.clickup_task_url }] : [],
    },
  );
  const googleResult = await safeGoogleSync(
    () =>
      syncGoogleUpdate(req, {
        meeting, organiser, client, project, attendees, attendeesChanged,
        clickupTaskLinks: clickupResult.personTaskLinks,
      }),
    {
      eventId: meeting.google_event_id,
      googleEmail: meeting.google_calendar_email,
      meetUrl: meeting.google_meet_url,
      htmlLink: meeting.google_html_link,
    },
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
  if (meeting.source === "calendar") return json({ error: CALENDAR_SOURCED_ERROR }, 400);

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

  // Each person has their own task (see 0099_internal_meeting_tasks) — delete
  // all of them. Falls back to the legacy single clickup_task_id for meetings
  // created before that migration, which have no internal_meeting_tasks rows.
  let clickupError: string | null = null;
  const { data: personTasks } = await sb
    .from("internal_meeting_tasks")
    .select("team_member_id, clickup_task_id")
    .eq("meeting_id", meeting.id);
  const taskIdsToDelete = ((personTasks ?? []) as Array<{ clickup_task_id: string | null }>)
    .map((t) => t.clickup_task_id)
    .filter((id): id is string => !!id);
  if (taskIdsToDelete.length === 0 && meeting.clickup_task_id) {
    taskIdsToDelete.push(meeting.clickup_task_id);
  }
  if (taskIdsToDelete.length > 0) {
    const { token: pat } = await getOperatorClickupToken(req);
    if (!pat) {
      clickupError = "No ClickUp token available (CLICKUP_PAT secret not set).";
    } else {
      const errors: string[] = [];
      for (const taskId of taskIdsToDelete) {
        try {
          const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
            method: "DELETE",
            headers: { Authorization: pat, "Content-Type": "application/json" },
          });
          if (!res.ok && res.status !== 404) {
            errors.push(`${taskId}: ClickUp delete ${res.status}: ${await res.text()}`);
          }
        } catch (e) {
          errors.push(`${taskId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (errors.length > 0) clickupError = errors.join("; ");
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
