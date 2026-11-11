// supabase/functions/_shared/review-list.ts
//
// A client's sign-off list, loaded exactly as their review page sees it. MOVED
// here from client-review/index.ts, unchanged, so stitch-waiting reads the same
// rows through the same filters (no parked rows, no internal notes, no
// staff-only columns) instead of a copy. The rules on what may and may not
// cross to a client are in client-review/index.ts's header and apply here in
// full: this IS that function's list query.
//
// The mirrored courtOf below is NOT stop-clock.ts's: it returns null for a
// task ClickUp has not been read for yet, which keeps an unknown status from
// moving an ask out of "Your move". Do not swap one for the other.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { suggestClientTitle, UNTITLED_WORK } from "./client-title.ts";
import type { ReviewItemState, ReviewItemType } from "./client-buckets.ts";

// --- wire types --------------------------------------------------------
// Mirrors src/types/client-review.ts. If you change one, change both. The
// three state/type unions are the exception: they come from _shared/client-buckets.ts.

export type ReviewContact = { id: string; full_name: string };

export type ReviewItem = {
  id: string; // client_approvals.id — NOT briefs.id
  item_type: ReviewItemType;
  client_title: string;
  ask: string;
  detail: string | null;
  due_date: string | null; // "YYYY-MM-DD"
  weighty: boolean;
  state: ReviewItemState;
  decided_at: string | null; // ISO timestamp
  decided_by_name: string | null;
  /** agreement only: when they committed, and where. Null on other types. */
  agreed_at: string | null; // "YYYY-MM-DD"
  agreed_via: string | null;
  owed_by: "client" | "us";
  /** ms this has sat with the client, from the linked task's ClickUp clock. */
  waiting_ms: number | null;
  /** ms it has sat with US — the other half of the same clock. Both halves
   *  reach the client on purpose; see the note in types/client-review.ts. */
  our_ms: number | null;
  /** Whose court the linked task is in now. Decides the pane. Null: no task. */
  court: "client" | "us" | "done" | null;
  /** The linked task's created_at — what makes a runway measurable. */
  work_since: string | null;
  /** Web addresses this ask is about (0162). CLIENT-VISIBLE by construction. */
  links: string[];
  /** When the email carrying this ask went out. Addresses are NOT sent. */
  emailed_at: string | null;
  /** Every time this changed sides. No staff name, no 'parked', ever. */
  moves: ReviewMove[];
  /** The two-way thread, oldest first. Never contains internal notes. */
  messages: ReviewMessage[];
  /** When we asked. Dates the opening message of the thread. */
  created_at: string;
  /** Who put this on the list. A client can raise a question or an event (0149). */
  raised_by: "us" | "client";
  /** The contact who raised it, resolved from the token. Never a staff name. */
  raised_by_name: string | null;
  /** What they wrote when they decided — their own words, shown as their message. */
  client_note: string | null;
};

/**
 * One state change, as the client may see it. Mirror of ReviewMove.
 *
 * There is no actor field on purpose — the mover is one of us, and rule 1 says
 * the client's only word for us is "Converted Click". `parked` transitions are
 * dropped where `moves` is built, not here and not on the client: parked is a
 * staff-only state and its name must not reach that page even as a from/to.
 */
export type ReviewMove = {
  id: string;
  at: string;
  from: ReviewItemState | null;
  to: ReviewItemState;
};

/** When someone on the CLIENT's side last opened their page. Names only. */
export type ReviewOpen = {
  name: string;
  at: string;
};

/**
 * One line of the school's delivery plan (0159), read from the
 * client_pipeline_schedule view — which is the only place this function may
 * read a school's pipeline from. The view is what leaves the staff columns
 * (assignee, department, estimate, who moved it) behind; selecting off
 * school_tasks here would put them one typo away from a client's screen.
 */
export type ReviewScheduleRow = {
  id: string; // school_tasks.id — NOT client_approvals.id
  label: string;
  side: "us" | "school";
  month_no: number;
  theme: string;
  shows_on: string; // "YYYY-MM-DD"
  completed_at: string | null; // ISO timestamp; ClickUp's own when it was briefed
};

/**
 * One message on an item's thread. `from` is deliberately coarse: a client
 * sees "Converted Click", never which of us typed it — the only two parties on
 * this page are their company and ours. Internal notes are filtered out
 * server-side and have no representation here at all.
 */
export type ReviewMessage = {
  id: string;
  from: "us" | "them";
  author: string | null; // their own colleague's name; null for our side
  body: string;
  at: string;
};

/**
 * One piece of briefed work on the client's own "Who's holding it up".
 * Mirrors ReviewWork in src/types/client-review.ts.
 *
 * SEVEN FIELDS. `title` is suggestClientTitle(briefs.raw_subject), sanitised
 * HERE — the raw subject never reaches a response. No status string, no
 * assignee, no points, no hours, no ClickUp url. Not decidable, never in
 * `items`.
 */
export type ReviewWork = {
  id: string; // briefs.id
  title: string;
  court: "client" | "us" | "done";
  waiting_ms: number | null;
  our_ms: number | null;
  work_since: string;
  due_date: string | null;
};


export type ListPayload = {
  status: "ok";
  company_name: string;
  as_at: string;
  contacts: ReviewContact[];
  /** Who on their side has opened their link. Client-level, not per item. */
  opens: ReviewOpen[];
  items: ReviewItem[];
  /** The school's own year, when they are on one. Empty otherwise. */
  schedule: ReviewScheduleRow[];
  /**
   * Briefed work that never became an ask. Reaches "Who's holding it up"
   * and nothing else — see ReviewWork.
   */
  work: ReviewWork[];
  /**
   * Who this link belongs to, when it belongs to somebody. The page shows
   * it back to them and skips the "And you are?" step entirely. Null on a
   * legacy company-wide link, where the picker is still the only way to
   * know who is acting.
   */
  signed_in_as: ReviewContact | null;
};

// --- DB row shapes — explicit columns only, never select('*') ----------

export type ApprovalRow = {
  id: string;
  item_type: string;
  client_title: string;
  ask: string;
  detail: string | null;
  due_date: string | null;
  weighty: boolean;
  state: string;
  decided_at: string | null;
  decided_by_name: string | null;
  agreed_at: string | null;
  agreed_via: string | null;
  owed_by: string;
  created_at: string;
  raised_by: string;
  raised_by_name: string | null;
  client_note: string | null;
  links: string[] | null;
  // The joined brief, one named column. See rule 1 at the top of this file.
  // PostgREST returns a to-one embed as an object at runtime but types it as
  // an array, so both shapes are accepted and normalised in toReviewItem.
  briefs?: BriefWait | BriefWait[] | null;
  // The email that carried this ask. Two columns and no more — `to_addresses`
  // and `composed_by` are on that table and neither belongs on this wire.
  outbound_emails?: EmailSent | EmailSent[] | null;
};

type EmailSent = {
  sent_at: string | null;
  status: string | null;
};

type BriefWait = {
  created_at: string | null;
  client_wait_ms: number | null;
  internal_wait_ms: number | null;
  clickup_task_status: string | null;
  completed_at: string | null;
};

/**
 * Mirror of courtOf in src/lib/client-waiting.ts — Deno cannot import from
 * src/, the same reason the types above are mirrored. Change one, change both.
 * The raw status string never leaves this function: it is ClickUp's private
 * vocabulary, and the client gets the derived court instead.
 */
const WAITING_STATUSES = ["waiting on client", "send to client"];
const DONE_STATUSES = ["complete", "closed", "done"];

function briefOf(briefs: BriefWait | BriefWait[] | null | undefined): BriefWait | null {
  if (!briefs) return null;
  return (Array.isArray(briefs) ? briefs[0] : briefs) ?? null;
}

function courtOf(briefs: BriefWait | BriefWait[] | null | undefined) {
  const row = briefOf(briefs);
  // No row, or a task ClickUp has not been read for yet, has NO court: an
  // unknown status must not move an ask out of the client's "Your move" pane.
  if (!row || (!row.clickup_task_status && !row.completed_at)) return null;
  const status = (row.clickup_task_status ?? "").toLowerCase();
  if (row.completed_at || DONE_STATUSES.includes(status)) return "done" as const;
  return WAITING_STATUSES.includes(status) ? ("client" as const) : ("us" as const);
}

const ITEM_TYPES: ReviewItemType[] = ["brief", "question", "agreement", "idea", "event"];

/** A uuid nothing has, so a "not in (...)" list is never empty. */
const NO_SUCH_ID = "00000000-0000-0000-0000-000000000000";

function waitingMsOf(briefs: BriefWait | BriefWait[] | null | undefined): number | null {
  return briefOf(briefs)?.client_wait_ms ?? null;
}

/** The one email column that reaches a client: when it went, if it went. */
function sentAtOf(emails: EmailSent | EmailSent[] | null | undefined): string | null {
  const row = (Array.isArray(emails) ? emails[0] : emails) ?? null;
  return row?.status === "sent" ? row.sent_at : null;
}

export function toReviewItem(
  row: ApprovalRow,
  messages: ReviewMessage[] = [],
  moves: ReviewMove[] = [],
): ReviewItem {
  return {
    id: row.id,
    // An unrecognised type degrades to the approval controls rather than
    // rendering nothing — a client must never meet an item with no way to act.
    item_type: (ITEM_TYPES as string[]).includes(row.item_type)
      ? (row.item_type as ReviewItemType)
      : "brief",
    client_title: row.client_title,
    ask: row.ask,
    detail: row.detail,
    due_date: row.due_date,
    weighty: row.weighty,
    state: row.state as ReviewItemState,
    decided_at: row.decided_at,
    decided_by_name: row.decided_by_name,
    agreed_at: row.agreed_at,
    agreed_via: row.agreed_via,
    owed_by: row.owed_by === "us" ? "us" : "client",
    created_at: row.created_at,
    raised_by: row.raised_by === "client" ? "client" : "us",
    raised_by_name: row.raised_by_name,
    client_note: row.client_note,
    waiting_ms: waitingMsOf(row.briefs),
    our_ms: briefOf(row.briefs)?.internal_wait_ms ?? null,
    court: courtOf(row.briefs),
    work_since: briefOf(row.briefs)?.created_at ?? null,
    links: row.links ?? [],
    emailed_at: sentAtOf(row.outbound_emails),
    moves,
    messages,
  };
}

export const APPROVAL_COLUMNS =
  "id, item_type, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name, agreed_at, agreed_via, owed_by, raised_by, raised_by_name, created_at, client_note, links, briefs(created_at, client_wait_ms, internal_wait_ms, clickup_task_status, completed_at), outbound_emails(sent_at, status)";
export async function loadReviewList(
  sb: SupabaseClient,
  clientId: string,
  contactId: string | null,
): Promise<{ ok: true; payload: ListPayload } | { ok: false; status: number; error: string }> {
  const asAt = new Date().toISOString();

  const { data: clientRaw, error: clientErr } = await sb
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    console.error("[client-review] client lookup failed:", clientErr.message);
    return { ok: false, status: 500, error: "Something went wrong on our side" };
  }

  const { data: contactsRaw, error: contactsErr } = await sb
    .from("contacts")
    .select("id, full_name")
    .eq("client_id", clientId)
    .not("full_name", "is", null)
    .order("full_name");
  if (contactsErr) {
    console.error("[client-review] contacts lookup failed:", contactsErr.message);
    return { ok: false, status: 500, error: "Something went wrong on our side" };
  }

  // state='parked' is EXCLUDED and must stay excluded. A parked item is one
  // nobody is acting on yet (0148) — including ideas we have not raised with
  // them at all — so it is ours, not theirs. Filtered in the query rather than
  // in JS, for the same reason kind='note' is: a later refactor of the mapping
  // must not be able to leak one onto a client's page.
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("client_approvals")
    .select(APPROVAL_COLUMNS)
    .eq("client_id", clientId)
    .neq("state", "parked")
    .order("state")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (itemsErr) {
    console.error("[client-review] items lookup failed:", itemsErr.message);
    return { ok: false, status: 500, error: "Something went wrong on our side" };
  }

  // The thread. kind='note' is EXCLUDED here and must stay excluded — an
  // internal note reaching a client is the one unrecoverable failure on this
  // page. Filtered in the query rather than in JS so a later refactor of the
  // mapping cannot leak one.
  const items = (itemsRaw ?? []) as unknown as ApprovalRow[];
  const { data: threadRaw, error: threadErr } = await sb
    .from("client_activity")
    .select("id, approval_id, kind, body, author_name, created_at")
    .eq("client_id", clientId)
    .in("kind", ["message", "client_message"])
    .order("created_at");
  if (threadErr) {
    console.error("[client-review] thread lookup failed:", threadErr.message);
    return { ok: false, status: 500, error: "Something went wrong on our side" };
  }

  // The state moves, for the history panel. A SECOND query rather than
  // widening the thread's `.in(...)` to include 'status', and the separation is
  // the safety: this select names no author column at all, so the staff member
  // who moved a state cannot reach the client even by accident. Same rule as
  // kind='note', enforced the same way — in the query, not in the mapping.
  const { data: movesRaw, error: movesErr } = await sb
    .from("client_activity")
    .select("id, approval_id, from_state, to_state, created_at")
    .eq("client_id", clientId)
    .eq("kind", "status")
    .order("created_at");
  if (movesErr) {
    console.error("[client-review] moves lookup failed:", movesErr.message);
    return { ok: false, status: 500, error: "Something went wrong on our side" };
  }

  // Who on their side has opened their link. Client-level, so one query for the
  // whole list rather than one per item. Only personal, unrevoked links count:
  // a shared link tells us nothing about who, and a revoked one is not a way in
  // any more. Not fatal — a history panel missing an open still reads.
  const { data: opensRaw, error: opensErr } = await sb
    .from("client_review_tokens")
    .select("last_used_at, contacts(full_name)")
    .eq("client_id", clientId)
    .not("contact_id", "is", null)
    .not("last_used_at", "is", null)
    .is("revoked_at", null);
  if (opensErr) console.error("[client-review] opens lookup failed:", opensErr.message);

  // The school's delivery plan. Read from the view, never from school_tasks —
  // see ReviewScheduleRow. A failure here is NOT fatal: the plan is context
  // beside the asks, and a client who cannot see next month's work must still
  // be able to answer this month's. Empty for every client that is not a school.
  const { data: scheduleRaw, error: scheduleErr } = await sb
    .from("client_pipeline_schedule")
    .select("id, label, side, month_no, theme, shows_on, completed_at")
    .eq("client_id", clientId)
    .order("shows_on");
  if (scheduleErr) {
    console.error("[client-review] schedule lookup failed:", scheduleErr.message);
  }

  // Briefed work that never became an ask (0139-era `client_approvals` rows
  // are the ones that did). It is what makes the client's "Who's holding it
  // up" the same tab staff read: without it a client with seven live tasks and
  // one agreement saw one row and reasonably concluded the page was broken.
  //
  // Three filters, and each is load-bearing:
  //   clickup_task_id not null  nothing untracked has a clock to draw
  //   completed_at is null      finished work is our record, not a reproach,
  //                             and it matches the staff tab's Open default
  //   brief_id not already used or the same task appears twice the moment
  //                             somebody drafts it as a sign-off
  //
  // raw_subject is sanitised on the next line and NEVER put on the response as
  // itself. Nothing that fails to sanitise is dropped: a task hidden from the
  // client is the bug this exists to fix, so an empty result becomes a neutral
  // label instead. Not fatal, like the schedule: their asks must still render.
  // A query of its own rather than a column on the items select: `items` is
  // fed to toReviewItem, and a Conductor id sitting on those rows is one
  // careless spread away from a client's screen. This also sees the PARKED
  // rows the items query filters out, so a parked sign-off's task does not
  // reappear here as loose work.
  const { data: linkedRaw, error: linkedErr } = await sb
    .from("client_approvals")
    .select("brief_id")
    .eq("client_id", clientId)
    .not("brief_id", "is", null);
  if (linkedErr) console.error("[client-review] linked briefs lookup failed:", linkedErr.message);
  const linkedBriefIds = (linkedRaw ?? [])
    .map((r) => (r as { brief_id: string | null }).brief_id)
    .filter((id): id is string => !!id);
  // One chain, never a reassigned builder: PostgREST's types recurse and
  // `q = q.not(...)` fails deno check with "instantiation excessively deep".
  // A client with no linked briefs excludes a uuid that cannot exist, which is
  // what keeps `in ()` from being empty and the filter in the QUERY — the same
  // rule the note/parked filters follow, for the same reason.
  const excluded = linkedBriefIds.length > 0 ? linkedBriefIds : [NO_SUCH_ID];
  const { data: workRaw, error: workErr } = await sb
    .from("briefs")
    .select(
      "id, raw_subject, client_wait_ms, internal_wait_ms, clickup_task_status, completed_at, original_due_date, created_at",
    )
    .eq("client_id", clientId)
    .not("clickup_task_id", "is", null)
    // Our own cost is never their business: an internal brief (0165) is work
    // we absorb, and a client watching our routine tick past is the bug this
    // line fixes. In the query, not in JS, like every other client-side filter.
    .neq("billing_type", "internal")
    // Archived = its ClickUp task is gone; not waiting on anyone.
    .neq("status", "archived")
    .is("completed_at", null)
    .not("id", "in", `(${excluded.join(",")})`)
    .order("created_at", { ascending: false });
  if (workErr) console.error("[client-review] work lookup failed:", workErr.message);

  const companyName = (clientRaw as { name: string } | null)?.name ?? "";
  const work: ReviewWork[] = (
    (workRaw ?? []) as unknown as (BriefWait & {
      id: string;
      raw_subject: string | null;
      original_due_date: string | null;
      created_at: string;
    })[]
  ).map((b) => ({
    id: b.id,
    title: suggestClientTitle(b.raw_subject, companyName) || UNTITLED_WORK,
    court: courtOf(b) ?? ("us" as const),
    waiting_ms: b.client_wait_ms,
    our_ms: b.internal_wait_ms,
    work_since: b.created_at,
    due_date: b.original_due_date,
  }));

  const byApproval = new Map<string, ReviewMessage[]>();
  for (const row of (threadRaw ?? []) as Array<{
    id: string;
    approval_id: string;
    kind: string;
    body: string;
    author_name: string | null;
    created_at: string;
  }>) {
    const from: "us" | "them" = row.kind === "client_message" ? "them" : "us";
    const list = byApproval.get(row.approval_id) ?? [];
    list.push({
      id: row.id,
      from,
      // Our side is always "Converted Click" and never a staff name.
      author: from === "them" ? row.author_name : null,
      body: row.body,
      at: row.created_at,
    });
    byApproval.set(row.approval_id, list);
  }

  // 'parked' is dropped HERE and not on the client, for the same reason parked
  // items are filtered in the items query: it is a staff-only state (0148), and
  // its name must not reach that page even as the from/to of a move. A row is
  // dropped if either end is parked — checked explicitly rather than with a
  // PostgREST .neq, because from_state is NULL on a first move and SQL's
  // NULL != 'parked' is NULL, which would silently drop that row too.
  const movesByApproval = new Map<string, ReviewMove[]>();
  for (const row of (movesRaw ?? []) as Array<{
    id: string;
    approval_id: string;
    from_state: string | null;
    to_state: string | null;
    created_at: string;
  }>) {
    if (!row.to_state) continue;
    if (row.from_state === "parked" || row.to_state === "parked") continue;
    const list = movesByApproval.get(row.approval_id) ?? [];
    list.push({
      id: row.id,
      at: row.created_at,
      from: (row.from_state as ReviewItemState | null) ?? null,
      to: row.to_state as ReviewItemState,
    });
    movesByApproval.set(row.approval_id, list);
  }

  // One row per person, newest open wins — the same contact can hold several
  // links (a fresh one is minted per question) and "when did she last look" is
  // one answer, not four.
  const latestOpen = new Map<string, string>();
  for (const row of (opensRaw ?? []) as Array<{
    last_used_at: string | null;
    contacts: { full_name: string | null } | { full_name: string | null }[] | null;
  }>) {
    const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) ?? null;
    const name = contact?.full_name;
    const at = row.last_used_at;
    if (!name || !at) continue;
    const seen = latestOpen.get(name);
    if (!seen || at > seen) latestOpen.set(name, at);
  }
  const opens: ReviewOpen[] = [...latestOpen.entries()].map(([name, at]) => ({ name, at }));

  const contacts = (contactsRaw ?? []) as ReviewContact[];
  const resp: ListPayload = {
    status: "ok",
    company_name: companyName,
    as_at: asAt,
    contacts,
    opens,
    items: items.map((row) =>
      toReviewItem(row, byApproval.get(row.id) ?? [], movesByApproval.get(row.id) ?? []),
    ),
    schedule: (scheduleRaw ?? []) as unknown as ReviewScheduleRow[],
    work,
    // Resolved from the contacts already fetched — a personal token whose
    // contact has since been deleted or had its name cleared falls back to
    // null, which puts the picker back rather than signing as nobody.
    signed_in_as: contactId ? (contacts.find((c) => c.id === contactId) ?? null) : null,
  };
  return { ok: true, payload: resp };
}
