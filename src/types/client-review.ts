// src/types/client-review.ts
//
// The wire contract for the client sign-off inbox (/review/:token) and its
// edge function `client-review`. Imported by the page, the review components
// and the hooks — it is the only cross-agent import in this feature.
//
// TWO RULES ENCODED HERE:
//  1. No staff identity exists in this file. There is no assignee, owner,
//     team_member_id, avatar or staff email field, and there never will be —
//     the only two parties a client sees are their own contacts and the
//     literal string "Converted Click".
//  2. Item titles are `client_title` (client_approvals.client_title, authored
//     by staff). `raw_subject` is not in this file and must never enter it.
//
// The edge function mirrors these types at the top of its own file, because
// Deno cannot import from src/. Change one, change both.

/** Which pane an item belongs to. Derived, never stored. */
export type ReviewBucket = "your-move" | "with-us" | "signed-off" | "coming-up";

/** What a client can decide. Matches client_approvals.state's non-pending values. */
export type ReviewDecision = "approved" | "changes_requested";

/**
 * client_approvals.state, verbatim.
 *
 * 'parked' is staff-only — an item that exists but whose time is not right.
 * 'noted' belongs to events and to nothing else (0149): a date nobody acts on.
 * Both are undecided, so neither carries a decided_at.
 *
 * The client-review function filters it out of the list query and the staff
 * preview mirrors that filter, so a parked item never reaches this page at
 * all. It is in the union because the staff table renders the same rows.
 */
export type ReviewItemState = "pending" | "parked" | "noted" | ReviewDecision;

/**
 * The "And you are?" picker. Names only — a contact's email never crosses the
 * wire; the edge function resolves contact_id -> email server-side.
 * Contacts with a null full_name are filtered out by the server, so this is
 * non-nullable by construction.
 */
export type ReviewContact = {
  id: string;
  full_name: string;
};

/**
 * What kind of thing the client is looking at. Three asks, three controls:
 *   brief     — a deliverable awaiting APPROVAL       (Approve / Request changes)
 *   question  — something we asked, awaiting an ANSWER (answer box + Send)
 *   agreement — something they committed to, awaiting DOING (Done / Not yet)
 *   idea      — worth considering, not planned. NO controls, because it never
 *               reaches a client: an idea is always parked (0148) and parked
 *               rows are filtered out server-side.
 *   event     — a date in the client's world, which THEY can add (0149). The
 *               only type nobody acts on, so it has no controls and its own
 *               state ('noted') rather than a type exclusion in every count.
 *
 * 'brief' is the value a task has carried since 0139 and is deliberately not
 * renamed to 'task' — the ClickUp candidates flow, the existing rows and
 * client_approvals_brief_ref_chk all key off it. "Task" is the label the UI
 * puts on it, nothing more.
 */
export type ReviewItemType = "brief" | "question" | "agreement" | "idea" | "event";

/** One row in the queue. `id` is client_approvals.id — never briefs.id. */
export type ReviewItem = {
  id: string;
  item_type: ReviewItemType;
  client_title: string;
  ask: string;
  detail: string | null;
  /** "YYYY-MM-DD" or null. Compare with todayISO() from @/lib/dates. */
  due_date: string | null;
  /** Carries liability — the UI marks the sign-off as consequential. */
  weighty: boolean;
  state: ReviewItemState;
  /** ISO timestamp, server-stamped at the decision. */
  decided_at: string | null;
  /** A CLIENT contact's name. The only person-name field in this file. */
  decided_by_name: string | null;
  /**
   * agreement only, null otherwise: when they committed and how. Shown back to
   * them verbatim — "you agreed on 4 Aug, in a meeting" is the whole point of
   * the type, and a date we cannot name is not accountability.
   */
  agreed_at: string | null;
  agreed_via: string | null;
  /**
   * Whose move this is. Only an agreement is ever "us" — a sign-off or a
   * question is the client's by definition. An agreement of ours shows on
   * their page under "With us" with no buttons: it is ours to close, and
   * offering them a Done button on our own commitment would be absurd.
   */
  owed_by: "client" | "us";
  /**
   * How long this has actually been sitting with the client, in ms, from the
   * linked task's ClickUp "waiting on client" clock.
   *
   * It exists because plenty of asks have no due date, and an ask with no date
   * still has an age. `created_at` cannot stand in for it: rows drafted from
   * ClickUp are written in a batch long after the client first got the work,
   * so it records when WE wrote it down, not when they were handed it.
   * Null when there is no linked task or the sync has not reached it yet.
   */
  waiting_ms: number | null;
  /** The two-way thread, oldest first. Never contains internal notes. */
  messages: ReviewMessage[];
  /** When we asked. Dates the opening message of the thread. */
  created_at: string;
  /**
   * Who put this on the list. A client can raise a question or an event from
   * their own page (0149), and their question must not open with a bubble
   * attributed to us — see threadOf.
   */
  raised_by: "us" | "client";
  /**
   * The client contact who raised it, resolved server-side from their personal
   * link and snapshotted. Null when we raised it, and null on a legacy shared
   * link where there is nobody to name. NEVER a staff name.
   */
  raised_by_name: string | null;
  /**
   * What they wrote when they decided — the answer to a question, or the note
   * that came with requesting changes. Their own words, so it belongs in the
   * thread as their message rather than disappearing into a confirmation
   * banner, which is where it used to go.
   */
  client_note: string | null;
};

/**
 * One message on an item's thread.
 *
 * `from` is deliberately coarse. A client sees "Converted Click", never which
 * of us typed it — the only two parties on that page are their company and
 * ours. `author` names their own colleague on their side so a thread with two
 * people from one company still reads. Internal notes are excluded server-side
 * and have no representation in this file at all.
 */
export type ReviewMessage = {
  id: string;
  from: "us" | "them";
  author: string | null;
  body: string;
  at: string;
};

/** Who is deciding. Either a known contact, or a free-typed "Someone else". */
export type ReviewIdentity =
  | { contact_id: string }
  | { name: string; email?: string };

/**
 * What the page remembers for the rest of the browser session, so every
 * decision after the first is one click. sessionStorage only — never sent by
 * the server, never persisted past the tab.
 */
export type RememberedApprover = {
  /** null when the person chose "Someone else". */
  contact_id: string | null;
  /** Display name, shown back to them as "Deciding as …". */
  name: string;
  email: string | null;
};

/** What the page hands the decide mutation. */
export type ReviewDecisionInput = {
  item_id: string;
  decision: ReviewDecision;
  /**
   * Required, non-empty, when decision === "changes_requested" OR the item is
   * a question (where the comment IS the answer). The server re-checks both
   * from the stored item_type — this type only documents it.
   */
  comment?: string;
  identity: ReviewIdentity;
};

// --- requests -------------------------------------------------------------

export type ListRequest = { action: "list"; token: string };

export type DecideRequest = {
  action: "decide";
  token: string;
} & ReviewDecisionInput;

export type ReplyRequest = {
  action: "reply";
  token: string;
  item_id: string;
  body: string;
};

/**
 * What a client can start themselves. Two kinds and no more: a question they
 * want answered, and a date we should know about. Deliberately NOT a way to
 * create work — "please redo the banner" is a conversation, and it arrives as
 * a question that staff turn into a brief.
 */
export type RaiseKind = "question" | "event";

export type RaiseRequest = {
  action: "raise";
  token: string;
  kind: RaiseKind;
  /** One line. What it is about. */
  title: string;
  /** The question itself. Required for a question, optional context for an event. */
  body?: string;
  /** "YYYY-MM-DD". Required for an event, ignored for a question. */
  date?: string;
};

export type RaiseResponse =
  | { status: "ok"; item: ReviewItem }
  | { status: "invalid"; reason: "missing_title" | "missing_body" | "missing_date" }
  | TokenFailure;

export type ClientReviewRequest = ListRequest | DecideRequest | ReplyRequest | RaiseRequest;

// --- responses ------------------------------------------------------------
//
// Token failures come back as HTTP 200 with a `status` discriminant, NOT as a
// 4xx. callEdgeFn collapses every non-2xx into a thrown Error and discards the
// status code, so a 410 would force the page to string-match error prose to
// tell expired from revoked. The thrown path is reserved for genuine network
// and 500 failure, rendered with errorMessage(e).

export type TokenFailure = { status: "expired" | "revoked" | "unknown" };

export type ListOk = {
  status: "ok";
  /** clients.name. The only company name in the payload. */
  company_name: string;
  /** ISO timestamp, server now() at request time. Renders as "As at HH:MM". */
  as_at: string;
  contacts: ReviewContact[];
  items: ReviewItem[];
  /**
   * Who this link belongs to, when it belongs to somebody (0142).
   *
   * Non-null means the token is personal: the page shows the name back to them
   * and never opens "And you are?", because the server resolves the signer
   * from the token and ignores whatever the body claims. Null is a legacy
   * company-wide link, where the picker is still the only way to know who
   * acted.
   */
  signed_in_as: ReviewContact | null;
};

export type ListResponse = ListOk | TokenFailure;

export type ReplyResponse =
  | { status: "ok"; message: ReviewMessage }
  | { status: "invalid"; reason: "unknown_item" | "missing_comment" | "unknown_contact" }
  | TokenFailure;

export type DecideResponse =
  | { status: "ok"; item: ReviewItem }
  /** Someone already decided this one — the page shows the decided state. */
  | { status: "already_decided"; item: ReviewItem }
  | { status: "invalid"; reason: "unknown_item" | "missing_comment" | "unknown_contact" }
  | TokenFailure;

/** Narrowing helper — every response type this API returns goes through it. */
export function isTokenFailure(
  r: ListResponse | DecideResponse | ReplyResponse | RaiseResponse,
): r is TokenFailure {
  return r.status === "expired" || r.status === "revoked" || r.status === "unknown";
}
