// supabase/functions/_shared/google-calendar.ts
//
// Thin wrapper around the Google Calendar v3 REST API for the organiser's
// `primary` calendar. Every call needs a caller-supplied OAuth access token
// (resolve one with getGoogleAccessToken from ./google-token.ts — not
// imported here to keep this module a pure HTTP client with no DB/JWT
// concerns of its own).
//
// Two details are load-bearing and easy to silently break:
//  - conferenceDataVersion=1 in the query string AND a
//    conferenceData.createRequest body with a fresh requestId are BOTH
//    required for a Meet link to be created. Either alone produces an
//    event with no conference.
//  - sendUpdates=all is required on create, patch AND delete, or attendees
//    are never emailed / never see the event land on their calendar.

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const SAST_TIME_ZONE = "Africa/Johannesburg";

export interface GoogleCalendarEvent {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
}

/** A bare email invites fresh (responseStatus defaults to needsAction); an
 * object with responseStatus preserves an existing attendee's RSVP so a
 * patch that touches the array doesn't reset everyone back to pending. */
export type AttendeeInput = string | { email: string; responseStatus?: string };

export interface GoogleCalendarEventResult {
  ok: boolean;
  status: number;
  event: GoogleCalendarEvent | null;
  error: string | null;
}

export interface GoogleCalendarDeleteResult {
  ok: boolean;
  status: number;
  error: string | null;
}

function eventBody(input: {
  summary?: string;
  description?: string;
  startIso?: string;
  endIso?: string;
  attendeeEmails?: AttendeeInput[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.startIso !== undefined) {
    body.start = { dateTime: input.startIso, timeZone: SAST_TIME_ZONE };
  }
  if (input.endIso !== undefined) {
    body.end = { dateTime: input.endIso, timeZone: SAST_TIME_ZONE };
  }
  if (input.attendeeEmails !== undefined) {
    body.attendees = input.attendeeEmails.map((a) => (typeof a === "string" ? { email: a } : a));
  }
  return body;
}

function newConferenceRequest(): Record<string, unknown> {
  return {
    createRequest: {
      requestId: crypto.randomUUID(),
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  };
}

async function toResult(res: Response, action: string): Promise<GoogleCalendarEventResult> {
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, event: null, error: `Google Calendar ${action} ${res.status}: ${text}` };
  }
  const event = (await res.json()) as GoogleCalendarEvent;
  return { ok: true, status: res.status, event, error: null };
}

export interface CreateEventInput {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  attendeeEmails: AttendeeInput[];
}

/**
 * Create a new event with a Google Meet conference, inviting every
 * attendee. Always requests a conference (a brand-new meeting never has
 * one yet) and always notifies attendees.
 */
export async function createEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<GoogleCalendarEventResult> {
  const body = {
    ...eventBody(input),
    conferenceData: newConferenceRequest(),
  };
  const url = `${CALENDAR_EVENTS_URL}?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toResult(res, "create");
}

export interface PatchEventInput {
  summary?: string;
  description?: string;
  startIso?: string;
  endIso?: string;
  /** Omit entirely (undefined) to leave the event's attendee array — and
   * everyone's RSVP status — untouched. Google's patch overwrites arrays
   * wholesale, so only pass this when the attendee list actually changed. */
  attendeeEmails?: AttendeeInput[];
  /**
   * Only true when the stored meet URL is null (the original create never
   * got a conference, e.g. Google was momentarily unhappy). Resending
   * createRequest on an event that already has a conference would try to
   * create a SECOND one — never do that.
   */
  requestConference?: boolean;
}

/**
 * Patch an existing event. Notifies attendees of the change. Only touches
 * conferenceData (and only adds conferenceDataVersion=1) when
 * `requestConference` is explicitly set.
 */
export async function patchEvent(
  accessToken: string,
  eventId: string,
  input: PatchEventInput,
): Promise<GoogleCalendarEventResult> {
  const body: Record<string, unknown> = eventBody(input);
  const params = new URLSearchParams({ sendUpdates: "all" });
  if (input.requestConference) {
    body.conferenceData = newConferenceRequest();
    params.set("conferenceDataVersion", "1");
  }
  const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}?${params.toString()}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toResult(res, "patch");
}

/** GET an existing event — used to read attendees[].responseStatus before a
 * patch that changes the attendee list, so surviving attendees keep their
 * RSVP instead of being reset to needsAction. */
export async function getEvent(
  accessToken: string,
  eventId: string,
): Promise<GoogleCalendarEventResult> {
  const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return toResult(res, "get");
}

/**
 * Delete an event, notifying attendees so it disappears from their
 * calendars too. A 410 (already gone) or 404 (not found on this calendar —
 * e.g. someone deleted it by hand in Google Calendar) is treated as
 * success: the end state the caller wants ("no such event") is already true.
 */
export async function deleteEvent(
  accessToken: string,
  eventId: string,
): Promise<GoogleCalendarDeleteResult> {
  const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const text = await res.text();
    return { ok: false, status: res.status, error: `Google Calendar delete ${res.status}: ${text}` };
  }
  return { ok: true, status: res.status, error: null };
}
