// supabase/functions/_shared/client-buckets.ts
//
// Which pane a sign-off sits in, and what its chip says. Lives here, not in
// src/, because two runtimes need the one definition: Vite (src/lib/client-review.ts
// re-exports it) and Deno (the stitch-waiting edge function imports it with
// the .ts extension).
//
// NO IMPORTS, on purpose. Vite imports this extensionless and Deno imports it
// with `.ts`; an import in here would have to satisfy both resolvers. The item
// shapes are typed on just the fields read, so the full ReviewItem/ReviewWork
// (src/types/client-review.ts) are assignable without being named.

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

/** The fields of a sign-off the bucketing rules read. ReviewItem satisfies it. */
export type BucketItem = {
  state: ReviewItemState;
  owed_by: "client" | "us";
  court?: "client" | "us" | "done" | null;
  item_type: ReviewItemType;
  raised_by?: string | null;
};

/** The one field of briefed work the bucketing rule reads. ReviewWork satisfies it. */
export type BucketWork = { court: "client" | "us" | "done" };

/**
 * Which pane an item sits in. The ball is with whoever has to act next:
 *   pending           → the client has not decided, so it is their move…
 *   …unless owed_by is "us": an agreement WE made is ours to deliver, so it
 *                       sits under "With us" and carries no buttons. Putting
 *                       our own commitment in their "Your move" pile would
 *                       ask them to close something they cannot do.
 *   …unless the linked task's own ClickUp clock says the work has come back
 *                       to our side: whoever is HOLDING IT UP is whose pane it
 *                       is in. An approval we asked for that we are now
 *                       reworking is not their move, and listing it under
 *                       "Your move" asks them to act on something they cannot.
 *   changes_requested → they answered and it came back to us
 *   approved          → done, kept for the record
 *   noted             → an event: a date, in nobody's court at all
 *
 * A finished task (court "done") does NOT settle anything: the work landing is
 * not the client agreeing to it, and moving an undecided ask into "Signed off"
 * would claim a sign-off nobody gave. It stays their move, which is what it is
 * — we are done, they have not answered.
 */
export function bucketOf(item: BucketItem): ReviewBucket {
  // An event is a date, not a job. It is in nobody's court, which is exactly
  // why it has its own state (0149) rather than being filtered out of the
  // three that are all about whose move it is.
  if (item.state === "noted") return "coming-up";
  if (item.state === "pending") {
    return item.owed_by === "us" || item.court === "us" ? "with-us" : "your-move";
  }
  if (item.state === "changes_requested") return "with-us";
  return "signed-off";
}

/**
 * Which pane a piece of briefed work sits in. THE SAME RULE `bucketOf` uses
 * for an ask, deliberately: whoever is holding it up is whose pane it is in.
 * Not a third rule, or the two halves of one list would disagree about what
 * "with us" means.
 *
 * Work is never settled and never a date, so only the two live panes apply.
 */
export function workBucketOf(w: BucketWork): ReviewBucket {
  return w.court === "client" ? "your-move" : "with-us";
}

/**
 * How many things sit in each pane. Every bucket is present, even at zero.
 *
 * `work` counts too, or the rail says 2 while the list shows 5 — the counts
 * and the rows must come from one accounting.
 */
export function bucketCounts(
  items: BucketItem[],
  work: BucketWork[] = [],
): Record<ReviewBucket, number> {
  const counts: Record<ReviewBucket, number> = {
    "your-move": 0,
    "with-us": 0,
    "signed-off": 0,
    "coming-up": 0,
  };
  for (const item of items) counts[bucketOf(item)] += 1;
  for (const w of work) counts[workBucketOf(w)] += 1;
  return counts;
}

/**
 * What the client is being asked to do, in their words. The chip is the only
 * thing that tells three very different asks apart in a single queue, so it
 * says the ACT, not the record type: "Question", not "client_approvals row of
 * type question".
 */
export const TYPE_LABEL: Record<ReviewItemType, string> = {
  brief: "Sign-off",
  question: "Question",
  agreement: "You agreed",
  // Staff-only. An idea is always parked (0148) and parked rows never cross to
  // a client, so this label is only ever read by the staff table.
  idea: "Idea",
  event: "Date",
};

/**
 * The chip. Two types read differently depending on which way they run: an
 * agreement depends on who made the promise, and a question depends on who
 * asked — "Question" over something the client themselves sent us reads as
 * though we are asking them their own question back.
 */
export function typeLabelFor(item: BucketItem): string {
  if (item.item_type === "agreement") return item.owed_by === "us" ? "We agreed" : "You agreed";
  if (item.item_type === "question" && item.raised_by === "client") return "You asked";
  return TYPE_LABEL[item.item_type];
}
