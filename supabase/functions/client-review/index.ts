// supabase/functions/client-review/index.ts
//
// Request:  POST { action: "list", token }
//           → 200 { status: "ok", company_name, as_at, contacts, items }
//             | 200 TokenFailure
//
//           POST { action: "decide", token, item_id, decision, comment?, identity }
//           → 200 { status: "ok", item }
//             | 200 { status: "already_decided", item }
//             | 200 { status: "invalid", reason }
//             | 200 TokenFailure
//
// The client sign-off inbox (/review/:token): a no-login page where a client
// sees everything awaiting their decision and acts on it. This function is
// the ENTIRE boundary between the client and the database — client_approvals
// and client_review_tokens carry no anon RLS policy on purpose (0139), so
// every read and write here runs on the service role and hand-picks the
// columns a client may see. `select('*')` is banned in this file.
//
// Identity: a token may be scoped to ONE contact (client_review_tokens.
// contact_id, 0142). When it is, the signer is resolved from the token and
// any `identity` in the request body is IGNORED outright — the link is the
// identity, and whoever holds it cannot nominate someone else to have signed.
// A legacy company-wide token (contact_id null) still falls back to the
// client-supplied "And you are?" identity, resolved against that client's
// contacts. New links should always be personal.
//
// Token handling: the token in the URL is never stored — token_hash (hex
// sha256) is looked up instead, so a leak of client_review_tokens does not
// hand anyone a working link. The plaintext token is never logged. The row
// match already IS an exact-equality lookup, but the fetched token_hash is
// re-checked with a timing-safe compare rather than trusted on string
// equality of two untrusted-length inputs.
//
// TokenFailure (expired / revoked / unknown) is always HTTP 200 with a
// `status` discriminant, NEVER a 4xx — the frontend's callEdgeFn collapses
// every non-2xx into a thrown Error and drops the status code, which would
// force it to string-match error prose to tell expired from revoked. A
// genuine DB fault on the token lookup is NOT the same as "no such token"
// (that would tell a client with a valid link that their link is dead) and
// is a real 500 instead.
//
// Two hard rules baked into the column lists below:
//   1. No staff identity ever leaves this function — no assignee, no staff
//      name/email, no team_members join, no points/hours/cost. Exactly ONE
//      column is ever read from `briefs`, by name: client_wait_ms, the ms the
//      linked task has sat in a waiting-on-client status. It is the client's
//      own elapsed time and carries no staff or internal information. Nothing
//      else from that table may be added — raw_subject in particular, which
//      is the reason this rule exists: real subjects read "DFT V1.1", "(QC)".
//      client_title lives on client_approvals only.
//   2. Every 500 body is a fixed generic string — a Postgres error message
//      is console.error'd, never interpolated into the response a client
//      can read.
//
// Deployed --no-verify-jwt: there is no Supabase Auth session on this route
// at all (the token IS the auth), so the gateway's JWT check would 401 every
// request before this code ever ran.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { timingSafeEqualHex } from "../_shared/hmac.ts";
import { getOperatorClickupToken } from "../_shared/clickup-token.ts";
import { postChatMessage, APPROVALS_CHANNEL_ID } from "../_shared/clickup-chat.ts";

// --- wire types --------------------------------------------------------
// Mirrors src/types/client-review.ts. If you change one, change both.

type ReviewDecision = "approved" | "changes_requested";
type ReviewItemState = "pending" | ReviewDecision;

const DECISIONS: ReviewDecision[] = ["approved", "changes_requested"];

type ReviewContact = { id: string; full_name: string };

/**
 * What kind of thing the client is looking at. They are three different asks
 * and the portal renders three different controls:
 *   brief     — a deliverable awaiting APPROVAL     (Approve / Request changes)
 *   question  — something we asked, awaiting an ANSWER (answer box + Send)
 *   agreement — something they committed to, awaiting DOING (Done / Not yet)
 * 'brief' is the historical value for a task and is not renamed.
 */
type ReviewItemType = "brief" | "question" | "agreement";

type ReviewItem = {
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
  /** The two-way thread, oldest first. Never contains internal notes. */
  messages: ReviewMessage[];
  /** When we asked. Dates the opening message of the thread. */
  created_at: string;
  /** What they wrote when they decided — their own words, shown as their message. */
  client_note: string | null;
};

/**
 * One message on an item's thread. `from` is deliberately coarse: a client
 * sees "Converted Click", never which of us typed it — the only two parties on
 * this page are their company and ours. Internal notes are filtered out
 * server-side and have no representation here at all.
 */
type ReviewMessage = {
  id: string;
  from: "us" | "them";
  author: string | null; // their own colleague's name; null for our side
  body: string;
  at: string;
};

type ReviewIdentity = { contact_id: string } | { name: string; email?: string };

type ListRequest = { action: "list"; token: string };

type ReplyRequest = {
  action: "reply";
  token: string;
  item_id: string;
  body: string;
};

type DecideRequest = {
  action: "decide";
  token: string;
  item_id: string; // client_approvals.id
  decision: ReviewDecision;
  comment?: string; // required non-empty when decision === "changes_requested"
  identity: ReviewIdentity;
};

type ClientReviewRequest = ListRequest | DecideRequest | ReplyRequest;

type TokenFailure = { status: "expired" | "revoked" | "unknown" };

type ListResponse =
  | {
      status: "ok";
      company_name: string;
      as_at: string;
      contacts: ReviewContact[];
      items: ReviewItem[];
      /**
       * Who this link belongs to, when it belongs to somebody. The page shows
       * it back to them and skips the "And you are?" step entirely. Null on a
       * legacy company-wide link, where the picker is still the only way to
       * know who is acting.
       */
      signed_in_as: ReviewContact | null;
    }
  | TokenFailure;

type ReplyResponse =
  | { status: "ok"; message: ReviewMessage }
  | { status: "invalid"; reason: "unknown_item" | "missing_comment" | "unknown_contact" }
  | TokenFailure;

type DecideResponse =
  | { status: "ok"; item: ReviewItem }
  | { status: "already_decided"; item: ReviewItem }
  | { status: "invalid"; reason: "unknown_item" | "missing_comment" | "unknown_contact" }
  | TokenFailure;

// --- DB row shapes — explicit columns only, never select('*') ----------

type TokenRow = {
  id: string;
  client_id: string;
  token_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  /** Set on a personal link. Null on a legacy company-wide one. */
  contact_id: string | null;
};

type ApprovalRow = {
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
  client_note: string | null;
  // The joined brief, one named column. See rule 1 at the top of this file.
  // PostgREST returns a to-one embed as an object at runtime but types it as
  // an array, so both shapes are accepted and normalised in toReviewItem.
  briefs?: BriefWait | BriefWait[] | null;
};

type BriefWait = { client_wait_ms: number | null };

const ITEM_TYPES: ReviewItemType[] = ["brief", "question", "agreement"];

function waitingMsOf(briefs: BriefWait | BriefWait[] | null | undefined): number | null {
  if (!briefs) return null;
  const row = Array.isArray(briefs) ? briefs[0] : briefs;
  return row?.client_wait_ms ?? null;
}

function toReviewItem(row: ApprovalRow, messages: ReviewMessage[] = []): ReviewItem {
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
    client_note: row.client_note,
    waiting_ms: waitingMsOf(row.briefs),
    messages,
  };
}

const APPROVAL_COLUMNS =
  "id, item_type, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name, agreed_at, agreed_via, owed_by, created_at, client_note, briefs(client_wait_ms)";

// --- token hashing + verification (pure, no I/O) ------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** null = verified. Order matters: a revoked link is reported as revoked even
 * past its expiry, not expired — the check that made it dead. */
function tokenFailure(row: TokenRow | null, candidateHash: string): TokenFailure | null {
  if (!row || !timingSafeEqualHex(row.token_hash, candidateHash)) return { status: "unknown" };
  if (row.revoked_at) return { status: "revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };
  return null;
}

// --- action handlers -----------------------------------------------------

async function handleList(
  sb: SupabaseClient,
  clientId: string,
  contactId: string | null,
): Promise<Response> {
  const asAt = new Date().toISOString();

  const { data: clientRaw, error: clientErr } = await sb
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    console.error("[client-review] client lookup failed:", clientErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }

  const { data: contactsRaw, error: contactsErr } = await sb
    .from("contacts")
    .select("id, full_name")
    .eq("client_id", clientId)
    .not("full_name", "is", null)
    .order("full_name");
  if (contactsErr) {
    console.error("[client-review] contacts lookup failed:", contactsErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }

  const { data: itemsRaw, error: itemsErr } = await sb
    .from("client_approvals")
    .select(APPROVAL_COLUMNS)
    .eq("client_id", clientId)
    .order("state")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (itemsErr) {
    console.error("[client-review] items lookup failed:", itemsErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
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
    return json({ error: "Something went wrong on our side" }, 500);
  }

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

  const contacts = (contactsRaw ?? []) as ReviewContact[];
  const resp: ListResponse = {
    status: "ok",
    company_name: (clientRaw as { name: string } | null)?.name ?? "",
    as_at: asAt,
    contacts,
    items: items.map((row) => toReviewItem(row, byApproval.get(row.id) ?? [])),
    // Resolved from the contacts already fetched — a personal token whose
    // contact has since been deleted or had its name cleared falls back to
    // null, which puts the picker back rather than signing as nobody.
    signed_in_as: contactId ? (contacts.find((c) => c.id === contactId) ?? null) : null,
  };
  return json(resp);
}

type ResolvedSigner = { name: string; email: string | null; contact_id: string | null };

/** One contact, scoped to its client. Used by both identity paths. */
async function loadContact(
  sb: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<ResolvedSigner | null> {
  const { data, error } = await sb
    .from("contacts")
    .select("id, full_name, email")
    .eq("id", contactId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  const contact = data as { id: string; full_name: string | null; email: string } | null;
  const name = contact?.full_name?.trim();
  if (!contact || !name) return null;
  return { name, email: contact.email, contact_id: contact.id };
}

/**
 * Resolves who is deciding, server-side.
 *
 * A PERSONAL TOKEN SHORT-CIRCUITS EVERYTHING. When the link belongs to one
 * contact, that contact is the signer and `identity` from the request body is
 * never read — otherwise the whole point of the personal link is lost, because
 * the body is written by whoever is holding it.
 *
 * On a legacy company-wide token the old behaviour stands: a client is never
 * trusted to say its own name for a known contact (the id is looked up here);
 * only the free-typed "Someone else" path stores what was typed, and even then
 * bounded and non-empty.
 */
async function resolveIdentity(
  sb: SupabaseClient,
  clientId: string,
  identity: ReviewIdentity,
  tokenContactId: string | null,
): Promise<ResolvedSigner | { reason: "unknown_contact" }> {
  if (tokenContactId) {
    const signer = await loadContact(sb, clientId, tokenContactId);
    return signer ?? { reason: "unknown_contact" };
  }
  if (identity && "contact_id" in identity && identity.contact_id) {
    const signer = await loadContact(sb, clientId, identity.contact_id);
    return signer ?? { reason: "unknown_contact" };
  }
  if (identity && "name" in identity && identity.name?.trim()) {
    return {
      name: identity.name.trim().slice(0, 120),
      email: identity.email?.trim() ? identity.email.trim().slice(0, 120) : null,
      contact_id: null,
    };
  }
  return { reason: "unknown_contact" };
}

/** Best-effort ClickUp ping — never allowed to fail the decision it reports. */
async function notifyDecision(
  req: Request,
  sb: SupabaseClient,
  clientId: string,
  item: ReviewItem,
  decision: ReviewDecision,
  deciderName: string,
  comment: string,
): Promise<void> {
  // Three item types, three sentences — "approved" is the wrong word for an
  // answered question, and an ops channel that says it teaches people to
  // ignore the channel.
  const approvedLine = item.item_type === "question"
    ? `💬 ${deciderName} at {company} answered: "${item.client_title}"\n> ${comment}`
    : item.item_type === "agreement"
    ? `🤝 ${deciderName} at {company} marked their agreement done: "${item.client_title}"`
    : `✅ ${deciderName} at {company} approved: "${item.client_title}"`;
  const { data: clientRaw } = await sb.from("clients").select("name").eq("id", clientId).maybeSingle();
  const companyName = (clientRaw as { name: string } | null)?.name ?? "a client";
  const { token: pat } = await getOperatorClickupToken(req);
  await postChatMessage(
    pat,
    APPROVALS_CHANNEL_ID,
    decision === "approved"
      ? approvedLine.replace("{company}", companyName)
      : `🔁 ${deciderName} at ${companyName} came back on: "${item.client_title}"\n> ${comment}`,
  ).catch(() => {});
}

/**
 * First hop of x-forwarded-for. Evidence only: an IP is trivially shared and
 * must never be used to recognise anyone. Bounded because the header is
 * attacker-controlled and this string lands in a column someone will read.
 */
function clientIpOf(req: Request): string | null {
  const raw = req.headers.get("x-forwarded-for") ?? "";
  const first = raw.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

/**
 * A client writes back on an item.
 *
 * Deliberately NOT a decision: replying leaves the item pending, because "here
 * is the info you asked for" and "I approve this" are different acts and
 * conflating them would sign things off nobody signed off. The staff side is
 * pinged, since a reply nobody sees is worse than no reply box at all.
 *
 * Identity comes from the token on a personal link (0142) exactly as it does
 * for a decision. On a legacy shared link there is nobody to name, so the
 * message is recorded without an author rather than refused — a client with an
 * old link must still be able to answer us.
 */
async function handleReply(
  req: Request,
  sb: SupabaseClient,
  clientId: string,
  body: ReplyRequest,
  tokenContactId: string | null,
): Promise<Response> {
  const text = body.body?.trim() ?? "";
  if (!body.item_id) return json({ error: "item_id required" }, 400);
  if (!text) return json({ status: "invalid", reason: "missing_comment" } satisfies ReplyResponse);

  const { data: itemRaw, error: itemErr } = await sb
    .from("client_approvals")
    .select("id, client_title")
    .eq("id", body.item_id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (itemErr) {
    console.error("[client-review] reply item lookup failed:", itemErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }
  if (!itemRaw) return json({ status: "invalid", reason: "unknown_item" } satisfies ReplyResponse);
  const item = itemRaw as { id: string; client_title: string };

  let authorName: string | null = null;
  if (tokenContactId) {
    try {
      const signer = await loadContact(sb, clientId, tokenContactId);
      authorName = signer?.name ?? null;
    } catch (e) {
      console.error("[client-review] reply identity lookup failed:", e instanceof Error ? e.message : e);
    }
  }

  const { data: insertedRaw, error: insertErr } = await sb
    .from("client_activity")
    .insert({
      client_id: clientId,
      approval_id: item.id,
      kind: "client_message",
      body: text.slice(0, 4000),
      contact_id: tokenContactId,
      author_name: authorName,
    })
    .select("id, body, author_name, created_at")
    .single();
  if (insertErr) {
    console.error("[client-review] reply insert failed:", insertErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }
  const inserted = insertedRaw as {
    id: string;
    body: string;
    author_name: string | null;
    created_at: string;
  };

  // Fire and forget, wrapped: a chat outage must never lose a client's message.
  (async () => {
    const { data: clientRaw } = await sb
      .from("clients").select("name").eq("id", clientId).maybeSingle();
    const companyName = (clientRaw as { name: string } | null)?.name ?? "a client";
    const { token: pat } = await getOperatorClickupToken(req);
    await postChatMessage(
      pat,
      APPROVALS_CHANNEL_ID,
      `💬 ${authorName ?? "Someone"} at ${companyName} replied on: "${item.client_title}"\n> ${text}`,
    ).catch(() => {});
  })().then(() => {}, () => {});

  return json({
    status: "ok",
    message: {
      id: inserted.id,
      from: "them",
      author: inserted.author_name,
      body: inserted.body,
      at: inserted.created_at,
    },
  } satisfies ReplyResponse);
}

async function handleDecide(
  req: Request,
  sb: SupabaseClient,
  clientId: string,
  body: DecideRequest,
  tokenContactId: string | null,
): Promise<Response> {
  const { item_id, decision, comment, identity } = body;
  if (!item_id || !decision || !DECISIONS.includes(decision)) {
    return json({ error: "item_id and a valid decision are required" }, 400);
  }

  const trimmedComment = comment?.trim() ?? "";

  // What kind of item this is decides what a decision must carry. Read it
  // from the row rather than the request — the client is never trusted to
  // tell us which validation applies to it.
  const { data: typeRaw, error: typeErr } = await sb
    .from("client_approvals")
    .select("item_type, client_title, ask")
    .eq("id", item_id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (typeErr) {
    console.error("[client-review] item type lookup failed:", typeErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }
  if (!typeRaw) return json({ status: "invalid", reason: "unknown_item" } satisfies DecideResponse);
  const current = typeRaw as { item_type: string; client_title: string; ask: string };
  const itemType = current.item_type;

  // A question's whole point is the answer, so an empty one is not a decision.
  // Changes requested without a note is the same failure in the other
  // direction: it sends work back saying nothing about what to change.
  const commentRequired = decision === "changes_requested" || itemType === "question";
  if (commentRequired && !trimmedComment) {
    return json({ status: "invalid", reason: "missing_comment" } satisfies DecideResponse);
  }

  let resolved: ResolvedSigner;
  try {
    const outcome = await resolveIdentity(sb, clientId, identity, tokenContactId);
    if ("reason" in outcome) return json({ status: "invalid", reason: outcome.reason } satisfies DecideResponse);
    resolved = outcome;
  } catch (e) {
    console.error("[client-review] identity lookup failed:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong on our side" }, 500);
  }

  const { data: updatedRaw, error: updateErr } = await sb
    .from("client_approvals")
    .update({
      state: decision,
      decided_at: new Date().toISOString(), // server-stamped, never accepted from the body
      decided_by_name: resolved.name,
      decided_by_email: resolved.email,
      decided_by_contact_id: resolved.contact_id,
      // The text AS IT READ when they clicked. Frozen here and never updated
      // again, so editing the item afterwards cannot rewrite what was agreed.
      decided_title: current.client_title,
      decided_ask: current.ask,
      decided_ip: clientIpOf(req),
      decided_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
      // Kept on every type, not just changes_requested: for a question this
      // column IS the answer, and for an agreement it is how they closed it.
      client_note: trimmedComment || null,
    })
    .eq("id", item_id)
    .eq("client_id", clientId)
    .eq("state", "pending") // the concurrency guard — a double-click is naturally idempotent
    .select(APPROVAL_COLUMNS)
    .maybeSingle();
  if (updateErr) {
    console.error("[client-review] decide update failed:", updateErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }

  if (updatedRaw) {
    const item = toReviewItem(updatedRaw as unknown as ApprovalRow);
    // Fired after the update succeeds, wrapped so it can never sink this
    // response — awaited only so it actually runs before the isolate is
    // recycled, never so its outcome is reported back to the client.
    // Fire and forget. A slow or hanging ClickUp call must not delay the
    // client seeing their approval land, and must never fail it.
    notifyDecision(req, sb, clientId, item, decision, resolved.name, trimmedComment)
      .then(() => {}, () => {});
    return json({ status: "ok", item } satisfies DecideResponse);
  }

  // Nothing matched the guarded update — either someone else already decided
  // it, or the id isn't this client's at all. Re-read within clientId (never
  // trusting item_id alone) to tell the two apart.
  const { data: existingRaw, error: existingErr } = await sb
    .from("client_approvals")
    .select(APPROVAL_COLUMNS)
    .eq("id", item_id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (existingErr) {
    console.error("[client-review] re-read after no-op update failed:", existingErr.message);
    return json({ error: "Something went wrong on our side" }, 500);
  }
  if (existingRaw) {
    return json({
      status: "already_decided",
      item: toReviewItem(existingRaw as unknown as ApprovalRow),
    } satisfies DecideResponse);
  }
  return json({ status: "invalid", reason: "unknown_item" } satisfies DecideResponse);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  // No state change is ever reachable by dereferencing a URL — a decision is
  // only ever POST { action: "decide", ... }.
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = (await req.json()) as ClientReviewRequest;
    if (!body?.token) return json({ error: "token required" }, 400);

    const sb = createServiceRoleClient();

    // --- verify the token, every action ------------------------------
    const candidateHash = await sha256Hex(body.token);
    const { data: tokenRowRaw, error: tokenErr } = await sb
      .from("client_review_tokens")
      .select("id, client_id, token_hash, expires_at, revoked_at, contact_id")
      .eq("token_hash", candidateHash)
      .maybeSingle();
    // A genuine DB fault here is NOT "no such token" — collapsing it to
    // `unknown` would tell a client with a valid link that their link is
    // dead, so it is a real 500 instead.
    if (tokenErr) {
      console.error("[client-review] token lookup failed:", tokenErr.message);
      return json({ error: "Something went wrong on our side" }, 500);
    }

    const failure = tokenFailure(tokenRowRaw as TokenRow | null, candidateHash);
    if (failure) return json(failure);
    const tokenRow = tokenRowRaw as TokenRow;
    const clientId = tokenRow.client_id;

    // Fire-and-forget freshness stamp — never blocks or fails the request.
    // Two-arg .then() (not .catch()) because the query builder's .then()
    // returns PromiseLike, not a full Promise.
    sb.from("client_review_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .then(
        () => {},
        () => {},
      );

    switch (body.action) {
      case "list":
        return await handleList(sb, clientId, tokenRow.contact_id);
      case "decide":
        return await handleDecide(req, sb, clientId, body, tokenRow.contact_id);
      case "reply":
        return await handleReply(req, sb, clientId, body, tokenRow.contact_id);
      default:
        return json({ error: "action must be 'list', 'decide' or 'reply'" }, 400);
    }
  } catch (e) {
    // Never interpolate the underlying message into a client-facing body —
    // console.error it (and never the plaintext token) and return the fixed
    // generic string instead.
    console.error("[client-review] unexpected error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong on our side" }, 500);
  }
});
