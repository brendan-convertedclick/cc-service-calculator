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
//      name/email, no team_members join, no points/hours/cost. `briefs` is
//      never selected at all; client_title lives on client_approvals only.
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

type ReviewItem = {
  id: string; // client_approvals.id — NOT briefs.id
  client_title: string;
  ask: string;
  detail: string | null;
  due_date: string | null; // "YYYY-MM-DD"
  weighty: boolean;
  state: ReviewItemState;
  decided_at: string | null; // ISO timestamp
  decided_by_name: string | null;
};

type ReviewIdentity = { contact_id: string } | { name: string; email?: string };

type ListRequest = { action: "list"; token: string };

type DecideRequest = {
  action: "decide";
  token: string;
  item_id: string; // client_approvals.id
  decision: ReviewDecision;
  comment?: string; // required non-empty when decision === "changes_requested"
  identity: ReviewIdentity;
};

type ClientReviewRequest = ListRequest | DecideRequest;

type TokenFailure = { status: "expired" | "revoked" | "unknown" };

type ListResponse =
  | {
      status: "ok";
      company_name: string;
      as_at: string;
      contacts: ReviewContact[];
      items: ReviewItem[];
    }
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
};

type ApprovalRow = {
  id: string;
  client_title: string;
  ask: string;
  detail: string | null;
  due_date: string | null;
  weighty: boolean;
  state: string;
  decided_at: string | null;
  decided_by_name: string | null;
};

function toReviewItem(row: ApprovalRow): ReviewItem {
  return {
    id: row.id,
    client_title: row.client_title,
    ask: row.ask,
    detail: row.detail,
    due_date: row.due_date,
    weighty: row.weighty,
    state: row.state as ReviewItemState,
    decided_at: row.decided_at,
    decided_by_name: row.decided_by_name,
  };
}

const APPROVAL_COLUMNS =
  "id, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name";

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

async function handleList(sb: SupabaseClient, clientId: string): Promise<Response> {
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

  const resp: ListResponse = {
    status: "ok",
    company_name: (clientRaw as { name: string } | null)?.name ?? "",
    as_at: asAt,
    contacts: (contactsRaw ?? []) as ReviewContact[],
    items: ((itemsRaw ?? []) as ApprovalRow[]).map(toReviewItem),
  };
  return json(resp);
}

/** Resolves who is deciding, server-side — a client is never trusted to say
 * its own name for a known contact; only the free-typed "Someone else" path
 * stores what was typed, and even then bounded and non-empty. */
async function resolveIdentity(
  sb: SupabaseClient,
  clientId: string,
  identity: ReviewIdentity,
): Promise<{ name: string; email: string | null } | { reason: "unknown_contact" }> {
  if (identity && "contact_id" in identity && identity.contact_id) {
    const { data: contactRaw, error: contactErr } = await sb
      .from("contacts")
      .select("id, full_name, email")
      .eq("id", identity.contact_id)
      .eq("client_id", clientId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    const contact = contactRaw as { full_name: string | null; email: string } | null;
    const name = contact?.full_name?.trim();
    if (!contact || !name) return { reason: "unknown_contact" };
    return { name, email: contact.email };
  }
  if (identity && "name" in identity && identity.name?.trim()) {
    return {
      name: identity.name.trim().slice(0, 120),
      email: identity.email?.trim() ? identity.email.trim().slice(0, 120) : null,
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
  const { data: clientRaw } = await sb.from("clients").select("name").eq("id", clientId).maybeSingle();
  const companyName = (clientRaw as { name: string } | null)?.name ?? "a client";
  const { token: pat } = await getOperatorClickupToken(req);
  await postChatMessage(
    pat,
    APPROVALS_CHANNEL_ID,
    decision === "approved"
      ? `✅ ${deciderName} at ${companyName} approved: "${item.client_title}"`
      : `🔁 ${deciderName} at ${companyName} requested changes on: "${item.client_title}"\n> ${comment}`,
  ).catch(() => {});
}

async function handleDecide(req: Request, sb: SupabaseClient, clientId: string, body: DecideRequest): Promise<Response> {
  const { item_id, decision, comment, identity } = body;
  if (!item_id || !decision || !DECISIONS.includes(decision)) {
    return json({ error: "item_id and a valid decision are required" }, 400);
  }

  const trimmedComment = comment?.trim() ?? "";
  if (decision === "changes_requested" && !trimmedComment) {
    return json({ status: "invalid", reason: "missing_comment" } satisfies DecideResponse);
  }

  let resolved: { name: string; email: string | null };
  try {
    const outcome = await resolveIdentity(sb, clientId, identity);
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
      client_note: decision === "changes_requested" ? trimmedComment : null,
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
    const item = toReviewItem(updatedRaw as ApprovalRow);
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
    return json({ status: "already_decided", item: toReviewItem(existingRaw as ApprovalRow) } satisfies DecideResponse);
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
      .select("id, client_id, token_hash, expires_at, revoked_at")
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
        return await handleList(sb, clientId);
      case "decide":
        return await handleDecide(req, sb, clientId, body);
      default:
        return json({ error: "action must be 'list' or 'decide'" }, 400);
    }
  } catch (e) {
    // Never interpolate the underlying message into a client-facing body —
    // console.error it (and never the plaintext token) and return the fixed
    // generic string instead.
    console.error("[client-review] unexpected error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong on our side" }, 500);
  }
});
