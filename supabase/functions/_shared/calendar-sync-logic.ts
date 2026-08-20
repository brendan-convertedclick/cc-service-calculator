// supabase/functions/_shared/calendar-sync-logic.ts
//
// Pure decision logic for sync-calendar-meetings. No fetch, no Deno APIs, no
// DB — every rule that decides whether a calendar event counts, whose time it
// consumed, and which client it belongs to lives here so it can be tested
// directly (calendar-sync-logic.test.ts).
//
// The governing idea: a calendar invite already carries the time. Start, end,
// who was asked and whether they said no. Nothing here measures anything —
// it only decides what a Google event MEANS.

/** Google's Calendar v3 event, narrowed to the fields we actually read. */
export interface CalendarEventLike {
  id?: string;
  status?: string;
  summary?: string;
  organizer?: { email?: string; self?: boolean };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email?: string;
    responseStatus?: string;
    resource?: boolean;
    self?: boolean;
  }>;
}

export interface ClassifyContext {
  /** Whose calendar this copy of the event came from. Lowercased. */
  calendarOwnerEmail: string;
  /**
   * Every address we own — team_members.email plus google_user_tokens.google_email.
   * Used to derive our internal DOMAINS, not matched directly: an alias like
   * accounts@ourdomain is us even though no team member owns it.
   */
  staffEmails: string[];
  /**
   * Google event ids already stored. An event we created in Conductor is
   * re-synced for RSVPs even when it has no external attendee to match on.
   */
  knownEventIds?: Set<string>;
}

export interface StaffAttendee {
  email: string;
  /** Google responseStatus verbatim: accepted | tentative | needsAction | declined */
  responseStatus: string;
}

export interface ClassifiedEvent {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organiserEmail: string | null;
  staff: StaffAttendee[];
  externalEmails: string[];
  externalDomains: string[];
  meetingType: "internal" | "client";
  hours: number;
}

export type EventClassification =
  | { kind: "skip"; reason: string }
  | { kind: "cancelled"; eventId: string }
  | { kind: "event"; event: ClassifiedEvent };

/**
 * Personal-mail providers. A client emailing from a gmail address is real,
 * but the DOMAIN can never identify them — mapping gmail.com to a client
 * would attribute every personal calendar event to that client forever. So
 * these never enter the pending queue and never resolve.
 */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "zoho.com",
  "webmail.co.za",
  "mweb.co.za",
  "telkomsa.net",
  "vodamail.co.za",
]);

/** Lowercased domain part of an email, or null if it isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** The domains we own, derived from our own addresses. */
export function internalDomainsFrom(staffEmails: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of staffEmails) {
    const d = emailDomain(e);
    if (d) out.add(d);
  }
  return out;
}

/**
 * Duration in hours. Returns 0 for anything non-positive so a malformed or
 * inverted event can never subtract from a client's total.
 */
export function eventHours(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / 3_600_000;
}

/**
 * Decide what a Google event means.
 *
 * Skips, in order: deleted-with-no-id, all-day events (a "date" without a
 * "dateTime" is an out-of-office or a birthday, not a meeting), zero-length
 * events, events with no staff participant at all, and events where every
 * staff participant declined.
 *
 * The RSVP rule (set by the user, 2026-08-20): only an outright `declined`
 * means "not there". `needsAction` is the resting state of every invite
 * nobody has clicked — treating it as absence would drop most real meetings.
 * `tentative` counts too.
 */
export function classifyEvent(
  event: CalendarEventLike,
  ctx: ClassifyContext,
): EventClassification {
  const eventId = event.id;
  if (!eventId) return { kind: "skip", reason: "no event id" };

  // showDeleted=true returns tombstones so a meeting cancelled AFTER we
  // synced it stops counting. Without this it would bill forever.
  if (event.status === "cancelled") return { kind: "cancelled", eventId };

  const startsAt = event.start?.dateTime;
  const endsAt = event.end?.dateTime;
  if (!startsAt || !endsAt) return { kind: "skip", reason: "all-day or timeless event" };

  const hours = eventHours(startsAt, endsAt);
  if (hours <= 0) return { kind: "skip", reason: "zero-length event" };

  const internalDomains = internalDomainsFrom(ctx.staffEmails);
  const ownerEmail = ctx.calendarOwnerEmail.trim().toLowerCase();
  const organiserEmail = event.organizer?.email?.trim().toLowerCase() ?? null;

  const staff: StaffAttendee[] = [];
  const externalEmails: string[] = [];
  const externalDomains = new Set<string>();
  const seen = new Set<string>();

  for (const a of event.attendees ?? []) {
    // Meeting rooms and equipment are attendees too. They have no time.
    if (a.resource) continue;
    const email = a.email?.trim().toLowerCase();
    const domain = emailDomain(email);
    if (!email || !domain || seen.has(email)) continue;
    seen.add(email);

    if (internalDomains.has(domain)) {
      staff.push({ email, responseStatus: a.responseStatus ?? "needsAction" });
    } else {
      externalEmails.push(email);
      // Freemail is a real person but an unusable identifier — count them as
      // external (so the meeting reads as a client meeting) without ever
      // offering the domain for mapping.
      if (!FREEMAIL_DOMAINS.has(domain)) externalDomains.add(domain);
    }
  }

  // A solo event carries no attendees array at all. The calendar owner is
  // still the one whose hour it was.
  if (staff.length === 0 && internalDomains.has(emailDomain(ownerEmail) ?? "")) {
    staff.push({ email: ownerEmail, responseStatus: "accepted" });
  }

  // An externally-organised invite where the organiser is not repeated in the
  // attendee list — count their domain, it is the best client signal there is.
  const organiserDomain = emailDomain(organiserEmail);
  if (
    organiserEmail && organiserDomain &&
    !internalDomains.has(organiserDomain) && !seen.has(organiserEmail)
  ) {
    externalEmails.push(organiserEmail);
    if (!FREEMAIL_DOMAINS.has(organiserDomain)) externalDomains.add(organiserDomain);
  }

  if (staff.length === 0) return { kind: "skip", reason: "nobody from our team on it" };
  if (staff.every((s) => s.responseStatus === "declined")) {
    return { kind: "skip", reason: "everyone from our team declined" };
  }

  const meetingType: "internal" | "client" = externalEmails.length > 0 ? "client" : "internal";

  // A staff-only event has no domain to attribute by, so it cannot reach a
  // client — unless Conductor created it, in which case the row already knows
  // its client and we are only here to refresh RSVPs.
  if (meetingType === "internal" && !ctx.knownEventIds?.has(eventId)) {
    return { kind: "skip", reason: "internal only, no external attendee to attribute by" };
  }

  return {
    kind: "event",
    event: {
      eventId,
      title: event.summary?.trim() || "(no title)",
      startsAt,
      endsAt,
      organiserEmail,
      staff,
      externalEmails,
      externalDomains: [...externalDomains],
      meetingType,
      hours,
    },
  };
}

/** A retainer project a meeting could be attributed to. */
export interface RetainerCandidate {
  id: string;
  retainer_monthly_fee_cents: number | null;
  created_at: string;
}

/**
 * Which retainer a client meeting belongs to.
 *
 * The user's rule is "a retainer client's meetings become part of that
 * retainer", but 6 clients carry more than one live retainer (up to 4), so
 * "that retainer" needs a tiebreak. Biggest monthly fee wins: a meeting with
 * a client is overwhelmingly about the main relationship, not the smallest
 * add-on. Ties fall to the oldest, then to the lowest id, so the same input
 * always picks the same project — a wobbling attribution would move hours
 * between retainers on every sync.
 *
 * Always overridable by hand on the meeting.
 */
export function pickRetainerProject(candidates: RetainerCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const feeDiff = (b.retainer_monthly_fee_cents ?? 0) - (a.retainer_monthly_fee_cents ?? 0);
    if (feeDiff !== 0) return feeDiff;
    const ageDiff = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (Number.isFinite(ageDiff) && ageDiff !== 0) return ageDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0].id;
}

/**
 * Resolve external domains to a client, most specific first.
 *
 * A single event can carry several external domains (a client plus their
 * printer). Whichever maps wins, and the winning domain is recorded on the
 * meeting so a wrong attribution can be traced back to the mapping that
 * caused it rather than guessed at.
 */
export function resolveClient(
  externalDomains: string[],
  domainToClient: Map<string, string>,
): { clientId: string; domain: string } | null {
  for (const d of externalDomains) {
    const clientId = domainToClient.get(d);
    if (clientId) return { clientId, domain: d };
  }
  return null;
}

/**
 * Which staff member owns the row.
 *
 * internal_meetings.organiser_id is NOT NULL and every RLS policy reads it,
 * so a client-organised event still needs one of ours in the slot. Prefer the
 * real organiser when they are ours; otherwise the alphabetically-first staff
 * attendee, which is stable across syncs regardless of whose calendar the
 * event was read from. The true organiser address is stored separately.
 */
export function pickOrganiser(
  staff: StaffAttendee[],
  organiserEmail: string | null,
  emailToMemberId: Map<string, string>,
): string | null {
  if (organiserEmail) {
    const own = emailToMemberId.get(organiserEmail);
    if (own) return own;
  }
  const ordered = [...staff].sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  for (const s of ordered) {
    const id = emailToMemberId.get(s.email);
    if (id) return id;
  }
  return null;
}
