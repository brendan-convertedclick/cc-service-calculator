// supabase/functions/sync-calendar-meetings/index.ts
//
// Request:  POST { days_back?, days_forward?, member_id?, dry_run?, create_tasks? }
//           → 200 { scanned, events, matched, created, updated, cancelled,
//                    skipped: {reason: n}, pending_domains: [...], members: [...] }
//
// Reads every connected staff member's Google Calendar and turns the client
// meetings it finds into internal_meetings rows, so "how much time did we
// spend on this client" can include the meetings nobody scheduled through
// Conductor.
//
// Nothing here measures time. A calendar invite already carries it: start,
// end, who was asked, and who said no. Attendance is the timer. That is why
// this feature needs no timesheet discipline from anyone to work.
//
// Three rules decide what counts, all of them in calendar-sync-logic.ts:
//   - only an outright `declined` means someone wasn't there (no-response is
//     the resting state of most invites and would otherwise delete the data)
//   - a meeting is attributed by the EMAIL DOMAIN of its external attendees;
//     a domain we can't resolve goes to pending_meeting_domains to be mapped
//   - a retainer client's meetings attach to that client's retainer project
//
// Safe to re-run: every write is keyed on google_event_id, and a backfill
// (days_forward: 0) never creates a ClickUp task, so re-running over a year
// of history cannot spam anyone's ClickUp.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { getGoogleAccessToken } from "../_shared/google-token.ts";
import { listEvents, type GoogleCalendarListedEvent } from "../_shared/google-calendar.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import {
  createMeetingTask,
  fetchListFields,
  meetingCustomFields,
  nativeMeetingTaskBody,
  resolveMeetingListId,
} from "../_shared/meeting-clickup.ts";
import { buildMeetingDescription, buildMeetingTaskName, meetingSprintPoints } from "../_shared/meeting-logic.ts";
import {
  classifyEvent,
  type ClassifiedEvent,
  pickOrganiser,
  pickRetainerProject,
  resolveClient,
  type RetainerCandidate,
} from "../_shared/calendar-sync-logic.ts";

const DEFAULT_DAYS_BACK = 14;
const DEFAULT_DAYS_FORWARD = 30;
/** A year of history in one call is fine; more than that means someone typo'd. */
const MAX_DAYS_BACK = 400;

interface Body {
  days_back?: number;
  days_forward?: number;
  member_id?: string;
  dry_run?: boolean;
  create_tasks?: boolean;
}

interface MemberRow {
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

/** A domain we saw but could not resolve, accumulated across the whole run. */
interface PendingDomain {
  domain: string;
  seen: number;
  hours: number;
  sampleTitle: string;
  sampleOrganiser: string | null;
}

function clampDays(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), MAX_DAYS_BACK);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  try {
    const sb = createServiceRoleClient();
    let body: Body = {};
    try {
      body = (await req.json()) ?? {};
    } catch { /* empty body from pg_cron is fine */ }

    const daysBack = clampDays(body.days_back, DEFAULT_DAYS_BACK);
    const daysForward = clampDays(body.days_forward, DEFAULT_DAYS_FORWARD);
    const dryRun = body.dry_run === true;
    const now = Date.now();
    const timeMinIso = new Date(now - daysBack * 86_400_000).toISOString();
    const timeMaxIso = new Date(now + daysForward * 86_400_000).toISOString();

    // ── Reference data ──────────────────────────────────────────────────

    const [membersRes, tokensRes, domainsRes, primaryRes, retainersRes] = await Promise.all([
      sb.from("team_members").select("id, full_name, email, clickup_user_id").is("archived_at", null),
      sb.from("google_user_tokens").select("team_member_id, google_email"),
      sb.from("client_domains").select("client_id, domain"),
      sb.from("clients").select("id, name, clickup_client_name, primary_domain").is("archived_at", null),
      sb.from("projects")
        .select("id, client_id, retainer_monthly_fee_cents, created_at")
        .eq("engagement_type", "retainer")
        .not("status", "in", "(archived,completed)"),
    ]);

    const members = (membersRes.data ?? []) as MemberRow[];
    const tokens = (tokensRes.data ?? []) as Array<{ team_member_id: string; google_email: string | null }>;
    const clients = (primaryRes.data ?? []) as Array<ClientRow & { primary_domain: string | null }>;

    // Every address we own. Used only to derive our internal domains, so an
    // alias nobody owns (accounts@, info@) still reads as us and never lands
    // in the pending-domain queue.
    const staffEmails = [
      ...members.map((m) => m.email),
      ...tokens.map((t) => t.google_email),
    ].filter((e): e is string => !!e).map((e) => e.toLowerCase());

    const emailToMemberId = new Map<string, string>();
    for (const m of members) if (m.email) emailToMemberId.set(m.email.toLowerCase(), m.id);
    for (const t of tokens) if (t.google_email) emailToMemberId.set(t.google_email.toLowerCase(), t.team_member_id);

    const memberById = new Map(members.map((m) => [m.id, m]));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    // Domain → client. client_domains is the intake mapping and the richer of
    // the two; clients.primary_domain fills gaps without overriding it.
    const domainToClient = new Map<string, string>();
    for (const c of clients) {
      const d = c.primary_domain?.trim().toLowerCase();
      if (d) domainToClient.set(d, c.id);
    }
    for (const row of (domainsRes.data ?? []) as Array<{ client_id: string; domain: string }>) {
      const d = row.domain?.trim().toLowerCase();
      if (d) domainToClient.set(d, row.client_id);
    }

    // Retainer candidates per client, for the auto-attach rule.
    const retainersByClient = new Map<string, RetainerCandidate[]>();
    for (const p of (retainersRes.data ?? []) as Array<RetainerCandidate & { client_id: string }>) {
      const list = retainersByClient.get(p.client_id) ?? [];
      list.push({ id: p.id, retainer_monthly_fee_cents: p.retainer_monthly_fee_cents, created_at: p.created_at });
      retainersByClient.set(p.client_id, list);
    }

    // Domains already dismissed as never-a-client stay dismissed — otherwise
    // every sync would resurrect the supplier list someone just cleared.
    const { data: ignoredRows } = await sb
      .from("pending_meeting_domains").select("domain").not("ignored_at", "is", null);
    const ignoredDomains = new Set(
      ((ignoredRows ?? []) as Array<{ domain: string }>).map((r) => r.domain),
    );

    const { data: knownRows } = await sb
      .from("internal_meetings").select("google_event_id, source").not("google_event_id", "is", null);
    const knownEventIds = new Set(
      ((knownRows ?? []) as Array<{ google_event_id: string }>).map((r) => r.google_event_id),
    );
    const conductorEventIds = new Set(
      ((knownRows ?? []) as Array<{ google_event_id: string; source: string }>)
        .filter((r) => r.source === "conductor").map((r) => r.google_event_id),
    );

    // ── Read the calendars ──────────────────────────────────────────────

    const pollable = tokens.filter((t) => !body.member_id || t.team_member_id === body.member_id);
    const memberReports: Array<{ member: string; events: number; error: string | null }> = [];

    // One event, one decision. Every attendee's copy of an event carries the
    // FULL attendee list with everyone's RSVP, so reading it from a second
    // colleague's calendar adds nothing — and processing it twice would race
    // on the same row. First calendar to hand it over wins.
    const uniqueEvents = new Map<string, GoogleCalendarListedEvent>();
    const ownerByEvent = new Map<string, string>();

    for (const token of pollable) {
      const member = memberById.get(token.team_member_id);
      const label = member?.full_name ?? token.google_email ?? token.team_member_id;
      const resolved = await getGoogleAccessToken(req, { memberId: token.team_member_id });
      if (!resolved.accessToken) {
        memberReports.push({ member: label, events: 0, error: resolved.error ?? "no access token" });
        continue;
      }
      const list = await listEvents(resolved.accessToken, { timeMinIso, timeMaxIso });
      if (!list.ok) {
        memberReports.push({ member: label, events: 0, error: list.error });
        continue;
      }
      const ownerEmail = (resolved.googleEmail ?? token.google_email ?? member?.email ?? "").toLowerCase();
      for (const e of list.events) {
        if (!e.id || uniqueEvents.has(e.id)) continue;
        uniqueEvents.set(e.id, e);
        ownerByEvent.set(e.id, ownerEmail);
      }
      memberReports.push({ member: label, events: list.events.length, error: list.error });
    }

    // ── Classify and write ──────────────────────────────────────────────

    const skipped: Record<string, number> = {};
    const pending = new Map<string, PendingDomain>();
    const errors: string[] = [];
    let matched = 0, created = 0, updated = 0, cancelledCount = 0;
    /** Meetings written this run that still need a ClickUp task. */
    const needTasks: Array<{ meetingId: string; event: ClassifiedEvent; clientId: string; projectId: string | null }> = [];

    for (const [eventId, raw] of uniqueEvents) {
      const verdict = classifyEvent(raw, {
        calendarOwnerEmail: ownerByEvent.get(eventId) ?? "",
        staffEmails,
        knownEventIds,
      });

      if (verdict.kind === "skip") {
        skipped[verdict.reason] = (skipped[verdict.reason] ?? 0) + 1;
        continue;
      }

      if (verdict.kind === "cancelled") {
        // Only ever close OUR mirror of a calendar event. A conductor row is
        // cancelled through manage-internal-meeting, which owns the Google
        // event and must also tell ClickUp.
        if (!dryRun && knownEventIds.has(eventId) && !conductorEventIds.has(eventId)) {
          const { error } = await sb.from("internal_meetings")
            .update({ status: "cancelled", calendar_synced_at: new Date().toISOString() })
            .eq("google_event_id", eventId).eq("source", "calendar");
          if (error) errors.push(`cancel ${eventId}: ${error.message}`);
          else cancelledCount++;
        }
        continue;
      }

      const event = verdict.event;

      // A Conductor-scheduled meeting already knows its client and project.
      // We are only here to refresh who actually accepted.
      if (conductorEventIds.has(eventId)) {
        if (!dryRun) {
          const { data: row } = await sb.from("internal_meetings")
            .select("id").eq("google_event_id", eventId).maybeSingle();
          if (row) await syncAttendees(sb, (row as { id: string }).id, event, emailToMemberId, false);
        }
        updated++;
        continue;
      }

      const hit = resolveClient(event.externalDomains, domainToClient);
      if (!hit) {
        // Nothing to attribute to. Queue the domains so a human can map them
        // — ranked by the hours they cost us, so the queue pays for itself
        // from the top down.
        for (const domain of event.externalDomains) {
          if (ignoredDomains.has(domain)) continue;
          const cur = pending.get(domain);
          if (cur) {
            cur.seen++;
            cur.hours += event.hours;
          } else {
            pending.set(domain, {
              domain,
              seen: 1,
              hours: event.hours,
              sampleTitle: event.title,
              sampleOrganiser: event.organiserEmail,
            });
          }
        }
        skipped["no client mapped for the external domain"] =
          (skipped["no client mapped for the external domain"] ?? 0) + 1;
        continue;
      }

      matched++;
      if (dryRun) continue;

      const organiserId = pickOrganiser(event.staff, event.organiserEmail, emailToMemberId);
      if (!organiserId) {
        errors.push(`${eventId}: no staff member matched an attendee address`);
        continue;
      }

      // The user's rule: a retainer client's meetings become part of that
      // retainer. pickRetainerProject settles which one when a client runs
      // several.
      const projectId = pickRetainerProject(retainersByClient.get(hit.clientId) ?? []);

      const row = {
        organiser_id: organiserId,
        client_id: hit.clientId,
        project_id: projectId,
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        status: "scheduled",
        source: "calendar",
        meeting_type: event.meetingType,
        google_event_id: eventId,
        organiser_email: event.organiserEmail,
        external_emails: event.externalEmails,
        matched_domain: hit.domain,
        calendar_synced_at: new Date().toISOString(),
      };

      const isNew = !knownEventIds.has(eventId);
      const { data: saved, error: upsertErr } = await sb
        .from("internal_meetings")
        .upsert(row, { onConflict: "google_event_id" })
        .select("id")
        .maybeSingle();
      if (upsertErr || !saved) {
        errors.push(`${eventId}: ${upsertErr?.message ?? "upsert returned no row"}`);
        continue;
      }
      const meetingId = (saved as { id: string }).id;
      if (isNew) {
        created++;
        knownEventIds.add(eventId);
      } else {
        updated++;
      }

      await syncAttendees(sb, meetingId, event, emailToMemberId, true);

      // ClickUp tasks for meetings that have not happened yet only. A
      // backfill over past months would otherwise create hundreds of tasks
      // for meetings that are already over — noise in a shared workspace,
      // and no use to anyone. Future client meetings get one so they behave
      // exactly like a meeting scheduled in Conductor.
      const startsInFuture = Date.parse(event.startsAt) > now;
      if (isNew && startsInFuture && body.create_tasks !== false) {
        needTasks.push({ meetingId, event, clientId: hit.clientId, projectId });
      }
    }

    // ── Persist the pending-domain queue ────────────────────────────────

    if (!dryRun && pending.size > 0) {
      // REPLACE, never accumulate. These figures describe the window that was
      // just scanned ("this domain cost us 6 hours in the last 14 days"), and
      // adding each run's total to the last would inflate the queue on every
      // tick without a single new meeting. first_seen_at and ignored_at are
      // left out of the payload so an existing row keeps both.
      const { error } = await sb.from("pending_meeting_domains").upsert(
        [...pending.values()].map((p) => ({
          domain: p.domain,
          seen_count: p.seen,
          unattributed_hours: Number(p.hours.toFixed(2)),
          sample_title: p.sampleTitle,
          sample_organiser_email: p.sampleOrganiser,
          last_seen_at: new Date().toISOString(),
        })),
        { onConflict: "domain" },
      );
      if (error) errors.push(`pending domains: ${error.message}`);
    }

    // ── ClickUp tasks (forward-dated meetings only) ─────────────────────

    let tasksCreated = 0;
    if (needTasks.length > 0) {
      const { token: pat } = await getOperatorClickupToken(req);
      if (!pat) {
        errors.push("No ClickUp token available — meeting rows written, tasks skipped.");
      } else {
        for (const item of needTasks) {
          try {
            tasksCreated += await createTasksForMeeting(sb, pat, item, clientById, emailToMemberId, memberById);
          } catch (e) {
            errors.push(`tasks for ${item.meetingId}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }

    return json({
      window: { from: timeMinIso, to: timeMaxIso },
      dry_run: dryRun,
      scanned: uniqueEvents.size,
      matched,
      created,
      updated,
      cancelled: cancelledCount,
      tasks_created: tasksCreated,
      skipped,
      pending_domains: [...pending.values()]
        .sort((a, b) => b.hours - a.hours)
        .map((p) => ({ domain: p.domain, meetings: p.seen, hours: Number(p.hours.toFixed(2)) })),
      members: memberReports,
      errors,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Bring the stored attendee list in line with the invite.
 *
 * `replace` deletes people who are no longer on the event — correct for a
 * calendar-sourced row, where the invite is the truth. Never for a Conductor
 * row: those attendees were chosen in-app and each has a ClickUp task, so
 * dropping them here would orphan it.
 */
async function syncAttendees(
  sb: SupabaseClient,
  meetingId: string,
  event: ClassifiedEvent,
  emailToMemberId: Map<string, string>,
  replace: boolean,
): Promise<void> {
  const rows = event.staff
    .map((s) => ({ memberId: emailToMemberId.get(s.email), responseStatus: s.responseStatus }))
    .filter((r): r is { memberId: string; responseStatus: string } => !!r.memberId);
  if (rows.length === 0) return;

  await sb.from("internal_meeting_attendees").upsert(
    rows.map((r) => ({
      meeting_id: meetingId,
      team_member_id: r.memberId,
      response_status: r.responseStatus,
    })),
    { onConflict: "meeting_id,team_member_id" },
  );

  if (replace) {
    await sb.from("internal_meeting_attendees")
      .delete()
      .eq("meeting_id", meetingId)
      .not("team_member_id", "in", `(${rows.map((r) => r.memberId).join(",")})`);
  }
}

/**
 * One ClickUp task per attending staff member, in the client's meetings list.
 * Mirrors what manage-internal-meeting creates — same list resolution, same
 * body, same custom fields — so a meeting Conductor noticed and a meeting
 * Conductor scheduled look identical in ClickUp.
 *
 * Declined attendees get no task: they are not going.
 */
async function createTasksForMeeting(
  sb: SupabaseClient,
  pat: string,
  item: { meetingId: string; event: ClassifiedEvent; clientId: string },
  clientById: Map<string, ClientRow>,
  emailToMemberId: Map<string, string>,
  memberById: Map<string, MemberRow>,
): Promise<number> {
  const client = clientById.get(item.clientId);
  if (!client) return 0;
  const listId = await resolveMeetingListId(sb, item.clientId);
  if (!listId) return 0;

  const cuFields = await fetchListFields(pat, listId);
  const clickupClientName = client.clickup_client_name ?? client.name;
  const customFields = meetingCustomFields(cuFields, clickupClientName, null);
  const { event } = item;

  const attending = event.staff.filter((s) => s.responseStatus !== "declined");
  const description = buildMeetingDescription({
    title: event.title,
    agenda: event.externalEmails.length > 0 ? `With: ${event.externalEmails.join(", ")}` : null,
    clientName: client.name,
    attendeeNames: attending.map((s) => memberById.get(emailToMemberId.get(s.email) ?? "")?.full_name ?? s.email),
    meetingId: item.meetingId,
  });
  const body = nativeMeetingTaskBody({
    description,
    startsAtMs: Date.parse(event.startsAt),
    endsAtMs: Date.parse(event.endsAt),
    points: meetingSprintPoints(event.startsAt, event.endsAt),
  });

  let n = 0;
  for (const s of attending) {
    const memberId = emailToMemberId.get(s.email);
    const member = memberId ? memberById.get(memberId) : undefined;
    if (!memberId || !member) continue;
    const created = await createMeetingTask(pat, listId, {
      name: buildMeetingTaskName(clickupClientName, event.title),
      body,
      customFields,
      clickupUserId: member.clickup_user_id,
      label: member.full_name,
    });
    await sb.from("internal_meeting_tasks").upsert({
      meeting_id: item.meetingId,
      team_member_id: memberId,
      clickup_task_id: created.taskId,
      clickup_task_url: created.taskUrl,
      clickup_sync_error: created.error,
    }, { onConflict: "meeting_id,team_member_id" });
    if (created.taskId) n++;
  }
  return n;
}
