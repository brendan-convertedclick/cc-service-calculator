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

/** Which of the three panes an item belongs to. Derived, never stored. */
export type ReviewBucket = "your-move" | "with-us" | "signed-off";

/** What a client can decide. Matches client_approvals.state's non-pending values. */
export type ReviewDecision = "approved" | "changes_requested";

/** client_approvals.state, verbatim. */
export type ReviewItemState = "pending" | ReviewDecision;

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

/** One row in the queue. `id` is client_approvals.id — never briefs.id. */
export type ReviewItem = {
  id: string;
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
  /** Required, non-empty, when decision === "changes_requested". */
  comment?: string;
  identity: ReviewIdentity;
};

// --- requests -------------------------------------------------------------

export type ListRequest = { action: "list"; token: string };

export type DecideRequest = {
  action: "decide";
  token: string;
} & ReviewDecisionInput;

export type ClientReviewRequest = ListRequest | DecideRequest;

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
};

export type ListResponse = ListOk | TokenFailure;

export type DecideResponse =
  | { status: "ok"; item: ReviewItem }
  /** Someone already decided this one — the page shows the decided state. */
  | { status: "already_decided"; item: ReviewItem }
  | { status: "invalid"; reason: "unknown_item" | "missing_comment" | "unknown_contact" }
  | TokenFailure;

/** Narrowing helper — both the page and the components use it. */
export function isTokenFailure(
  r: ListResponse | DecideResponse,
): r is TokenFailure {
  return r.status === "expired" || r.status === "revoked" || r.status === "unknown";
}
