// src/lib/client-timeline.ts
//
// One item's story with a client, in order.
//
// Not everything, deliberately. ClickUp's activity feed logs every field edit
// and is therefore read by nobody; what anyone actually wants before picking
// up the phone is the four or five touch points that say how this has gone:
// when we asked, whether the email went out, whether they have opened their
// link at all, what we have chased them with, and what they decided.
//
// Most of that is derived rather than stored — the facts already live in
// columns, and writing them a second time as event rows would give two sources
// for one truth. See migration 0143. This module is the merge, and it is pure:
// no network, no React, so "what happened and in what order" has one
// definition and can be tested without a database.

export type TimelineKind =
  | "asked"
  | "emailed"
  | "opened"
  | "message"
  | "replied"
  | "note"
  | "status"
  | "decided";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: string;
  /** One line, already phrased for a reader. */
  summary: string;
  /** The quoted body, where there is one: a message, a note, a client's reply. */
  body?: string | null;
  /** Who did it. "Converted Click" is never used — staff names are fine here,
   *  this is the STAFF panel; nothing in this module reaches a client. */
  actor?: string | null;
};

/** The stored half: rows from client_activity. */
export type ActivityRow = {
  id: string;
  kind: string;
  /** Null only on a status row, where the text is an optional reason. */
  body: string | null;
  created_at: string;
  outbound_email_id: string | null;
  author_name: string | null;
  from_state?: string | null;
  to_state?: string | null;
};

/**
 * How a state reads to staff. The DB values are the four in client_approvals;
 * these are the words the team uses, and they are the same ones the sign-offs
 * table shows — see STATE_LABEL / SETTLED_LABEL in ClientSignoffs.
 */
const STATE_WORD: Record<string, string> = {
  pending: "waiting on the client",
  changes_requested: "back with us",
  approved: "signed off",
};

/**
 * "Brendan moved this back to waiting on the client."
 *
 * Naming where it came FROM is what makes a reopen legible: "moved to waiting
 * on the client" alone reads like the first time it was ever sent.
 */
function statusSummary(row: ActivityRow): string {
  const who = row.author_name ?? "Someone";
  const to = STATE_WORD[row.to_state ?? ""] ?? (row.to_state ?? "another state");
  const reopened = row.from_state === "approved" || row.from_state === "changes_requested";
  return reopened && row.to_state === "pending"
    ? `${who} reopened this — back to ${to}`
    : `${who} moved this to ${to}`;
}

/** The derived half: the columns that already hold the fixed events. */
export type TimelineSource = {
  created_at: string;
  state: string;
  item_type: string;
  decided_at: string | null;
  decided_by_name: string | null;
  client_note: string | null;
  /** outbound_emails for the first email that carried this item, if any. */
  emailed_at: string | null;
  emailed_to: string[] | null;
  email_failed: string | null;
  /** Per-person link opens: contact name -> last_used_at. */
  opens: { name: string; at: string }[];
};

const SETTLED_VERB: Record<string, string> = {
  brief: "approved it",
  question: "answered",
  agreement: "marked it done",
};

/**
 * Everything that has happened to one item, oldest first.
 *
 * Oldest-first and not newest-first because this is read as a story — "we
 * asked, it went out, she opened it, we chased twice, nothing" only makes
 * sense forwards. The composer sits under the newest entry, as it does in
 * every messaging surface anyone already uses.
 */
export function buildTimeline(source: TimelineSource, rows: ActivityRow[]): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "asked",
      kind: "asked",
      at: source.created_at,
      summary:
        source.item_type === "agreement"
          ? "Recorded as something they agreed to"
          : source.item_type === "question"
            ? "Question raised"
            : "Sent for sign-off",
    },
  ];

  if (source.emailed_at) {
    const to = source.emailed_to?.length ? source.emailed_to.join(", ") : "the client";
    events.push({
      id: "emailed",
      kind: "emailed",
      at: source.emailed_at,
      summary: `Emailed to ${to}`,
    });
  } else if (source.email_failed) {
    events.push({
      id: "email-failed",
      kind: "emailed",
      at: source.created_at,
      summary: "Email did not go out",
      body: source.email_failed,
    });
  }

  for (const open of source.opens) {
    events.push({
      id: `open-${open.name}-${open.at}`,
      kind: "opened",
      at: open.at,
      summary: `${open.name} last opened their sign-off page`,
    });
  }

  for (const row of rows) {
    // Four kinds, four sentences. A reply from the client, a chase we sent and
    // somebody dragging the status must never read alike in a list someone
    // skims before phoning them.
    if (row.kind === "status") {
      events.push({
        id: row.id,
        kind: "status",
        at: row.created_at,
        summary: statusSummary(row),
        // The body on a status row is the optional reason, not the content.
        body: row.body,
      });
      continue;
    }

    const kind: TimelineKind =
      row.kind === "note" ? "note" : row.kind === "client_message" ? "replied" : "message";
    events.push({
      id: row.id,
      kind,
      at: row.created_at,
      summary:
        kind === "note"
          ? "Internal note"
          : kind === "replied"
            ? `${row.author_name ?? "They"} replied`
            : "We messaged them",
      body: row.body,
      // The author is already in the summary for a reply; repeating it there
      // would render "Asavela replied · Asavela".
      actor: kind === "replied" ? null : row.author_name,
    });
  }

  if (source.decided_at) {
    const who = source.decided_by_name ?? "Someone there";
    const verb =
      source.state === "changes_requested"
        ? "sent it back"
        : (SETTLED_VERB[source.item_type] ?? "approved it");
    events.push({
      id: "decided",
      kind: "decided",
      at: source.decided_at,
      summary: `${who} ${verb}`,
      body: source.client_note,
    });
  }

  // Stable: equal timestamps keep the order they were pushed in, which is the
  // order the events logically happen (asked before emailed before opened).
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i)
    .map(({ e }) => e);
}

/** "31 Aug at 13:45". Local time — this is read by people sitting in SAST. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} at ${d.toLocaleTimeString(
    "en-ZA",
    { hour: "2-digit", minute: "2-digit", hour12: false },
  )}`;
}
