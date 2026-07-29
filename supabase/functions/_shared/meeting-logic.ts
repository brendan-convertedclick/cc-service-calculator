// supabase/functions/_shared/meeting-logic.ts
//
// Pure helpers for the internal-meetings feature. No fetch, no Deno APIs —
// unit-tested directly in meeting-logic.test.ts. Imported by
// manage-internal-meeting/index.ts (Google Calendar event + ClickUp task
// building) and, where useful, by the frontend form.

/**
 * Converts a "YYYY-MM-DDTHH:MM" (or "...:SS") local datetime — as produced
 * by combining a native <input type="date"> + <input type="time"> — into an
 * ISO 8601 string with an explicit +02:00 offset. SAST (Africa/Johannesburg)
 * has no DST, so the offset is always +02:00; we never hand this off to
 * `new Date(...).toISOString()`, which would silently reinterpret the local
 * wall-clock time as UTC.
 */
export function sastLocalToIso(localDateTime: string): string {
  const trimmed = localDateTime.trim();
  const hasSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed);
  const hasMinutesOnly = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed);
  if (!hasSeconds && !hasMinutesOnly) {
    throw new Error(`sastLocalToIso: expected "YYYY-MM-DDTHH:MM[:SS]", got "${localDateTime}"`);
  }
  const withSeconds = hasSeconds ? trimmed : `${trimmed}:00`;
  return `${withSeconds}+02:00`;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_POINT = 15;

/**
 * Duration → sprint points, on the same 1 point = 15 min scale as
 * buildBriefTaskBody's time_estimate. Rounded to the nearest quarter point,
 * floored at 1 so a 5-minute stand-in-a-meeting task never books as 0.
 */
export function meetingSprintPoints(startIso: string, endIso: string): number {
  const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const rawPoints = durationMs / MS_PER_MINUTE / MINUTES_PER_POINT;
  const roundedToQuarter = Math.round(rawPoints * 4) / 4;
  return Math.max(1, roundedToQuarter);
}

/** ClickUp task name for a meeting: "[Meeting] {clientName} — {title}". */
export function buildMeetingTaskName(clientName: string, title: string): string {
  return `[Meeting] ${clientName} — ${title}`;
}

/**
 * Pull the Google Meet URL out of a Calendar API event resource. Prefers
 * the top-level `hangoutLink` (set whenever a Meet conference exists);
 * falls back to the conferenceData entry point of type "video" for the
 * rare case hangoutLink is absent but conferenceData still resolved.
 * Returns null if neither is present (e.g. conference creation is still
 * pending, or the event has no conference at all).
 */
export function extractMeetUrl(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as {
    hangoutLink?: unknown;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }> };
  };
  if (typeof e.hangoutLink === "string" && e.hangoutLink.length > 0) return e.hangoutLink;
  const entryPoints = e.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find((ep) => ep?.entryPointType === "video");
    if (video && typeof video.uri === "string" && video.uri.length > 0) return video.uri;
  }
  return null;
}

export interface MeetingDescriptionInput {
  title: string;
  agenda?: string | null;
  clientName: string;
  projectName?: string | null;
  attendeeNames: string[];
  meetUrl?: string | null;
  meetingId: string;
}

/**
 * Shared description body for both the Google Calendar event and the
 * ClickUp task, so the two never drift out of sync.
 */
export function buildMeetingDescription(input: MeetingDescriptionInput): string {
  const lines: string[] = [
    `${input.title} — ${input.clientName}${input.projectName ? ` / ${input.projectName}` : ""}`,
  ];
  if (input.agenda && input.agenda.trim().length > 0) {
    lines.push("", "Agenda:", input.agenda.trim());
  }
  if (input.attendeeNames.length > 0) {
    lines.push("", `Attendees: ${input.attendeeNames.join(", ")}`);
  }
  if (input.meetUrl) {
    lines.push("", `Join: ${input.meetUrl}`);
  }
  lines.push("", `Scheduled via Conductor (internal meeting ${input.meetingId}).`);
  return lines.join("\n");
}
