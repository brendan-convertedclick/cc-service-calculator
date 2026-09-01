// src/hooks/useClientSignoffs.ts
//
// The staff side of the client sign-off inbox: what every client owes us, and
// a faithful preview of the page they see.
//
// The preview hook deliberately returns the SAME ListResponse shape the
// `client-review` edge function returns, so /client-signoffs can render the
// real <ClientReview> component tree rather than a staff-only lookalike. A
// second rendering would drift from what clients actually see, which is the
// one thing a preview must never do.
//
// Staff read these tables through RLS on their own session; the service-role
// edge function is only for the tokenless client. The column lists here mirror
// the function's on purpose — if one gains a field that must not reach a
// client, the other must not gain it either.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import type { ListResponse, ReviewContact, ReviewItem } from "@/types/client-review";

/**
 * PostgREST returns a to-one embed as an object at runtime but types it as an
 * array. Accept both rather than casting the whole row through `unknown`.
 */
type BriefWait = { client_wait_ms: number | null };
function waitingMsOf(briefs: BriefWait | BriefWait[] | null | undefined): number | null {
  if (!briefs) return null;
  const row = Array.isArray(briefs) ? briefs[0] : briefs;
  return row?.client_wait_ms ?? null;
}

/** One row of the cross-client queue, for the aggregate table and rail counts. */
export type SignoffRow = ReviewItem & {
  client_id: string;
  client_name: string;
  created_at: string;
  /** Staff-side only. For an agreement of ours: the task it became. */
  brief_id: string | null;
};

// briefs(client_wait_ms) is the ONE column read from briefs, mirroring the
// edge function's rule 1 — see the header of supabase/functions/client-review.
const ITEM_COLUMNS =
  "id, client_id, item_type, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name, agreed_at, agreed_via, owed_by, created_at, client_note, briefs(client_wait_ms)";

/**
 * The evidence behind one decision (0142). Staff-only — none of it crosses to
 * the client, and decided_title/decided_ask are the FROZEN text, which is the
 * whole reason to read them rather than the live columns: they say what the
 * person actually agreed to, not what the item says today.
 */
export type SignoffEvidence = {
  decided_at: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
  decided_by_contact_id: string | null;
  decided_title: string | null;
  decided_ask: string | null;
  decided_ip: string | null;
  decided_user_agent: string | null;
  client_note: string | null;
  client_title: string;
  ask: string;
};

export function useSignoffEvidence(approvalId: string | undefined) {
  return useQuery({
    queryKey: ["signoff-evidence", approvalId ?? ""],
    enabled: !!approvalId,
    queryFn: async (): Promise<SignoffEvidence> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .select(
          "decided_at, decided_by_name, decided_by_email, decided_by_contact_id, decided_title, decided_ask, decided_ip, decided_user_agent, client_note, client_title, ask",
        )
        .eq("id", approvalId!)
        .single();
      if (error) throw new Error(errorMessage(error));
      return data as SignoffEvidence;
    },
  });
}

/**
 * Staff-only additions to the mirrored list above. brief_id is a Conductor id
 * with no meaning to a client and deliberately never enters ITEM_COLUMNS —
 * that constant's value is that it cannot quietly gain a field the edge
 * function does not also have.
 */
const STAFF_ONLY_COLUMNS = "brief_id";

/** Whole days an undecided item has been past its due date. 0 when not late. */
export function daysWaiting(row: SignoffRow): number {
  if (row.state !== "pending" || !row.due_date) return 0;
  const due = new Date(`${row.due_date}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

/**
 * Every sign-off across every client, newest first. Small by nature — one row
 * per thing a client was ever asked to decide — so it is fetched whole rather
 * than paged.
 */
export function useClientSignoffs() {
  return useQuery({
    queryKey: ["client-signoffs"],
    queryFn: async (): Promise<SignoffRow[]> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .select(`${ITEM_COLUMNS}, ${STAFF_ONLY_COLUMNS}, clients!inner(name)`)
        .order("created_at", { ascending: false });
      if (error) throw new Error(errorMessage(error));

      return (data ?? []).map((r) => {
        const { clients, briefs, ...rest } = r as typeof r & {
          clients: { name: string } | null;
          briefs: BriefWait | BriefWait[] | null;
        };
        return {
          ...(rest as Omit<SignoffRow, "client_name" | "waiting_ms">),
          client_name: clients?.name ?? "Unknown client",
          waiting_ms: waitingMsOf(briefs),
        };
      });
    },
  });
}

/**
 * The client's own payload, rebuilt from a staff session. Mirrors the edge
 * function's `list` response field for field so the preview renders through
 * the same component tree the client gets.
 *
 * Never returns a token failure — staff reach this by client id, not by link,
 * so "is the link alive" is a separate question answered on the page itself.
 */
export function useClientReviewPreview(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-review-preview", clientId ?? ""],
    enabled: !!clientId,
    queryFn: async (): Promise<ListResponse> => {
      if (!clientId) throw new Error("No client selected");

      const [clientRes, contactRes, itemRes, threadRes] = await Promise.all([
        supabase.from("clients").select("name").eq("id", clientId).single(),
        supabase
          .from("contacts")
          .select("id, full_name")
          .eq("client_id", clientId)
          .not("full_name", "is", null)
          .order("full_name"),
        supabase
          .from("client_approvals")
          .select(ITEM_COLUMNS)
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
        // kind='note' EXCLUDED, exactly as the edge function excludes it. An
        // internal note appearing in the preview would be a staff-only leak in
        // the one place whose job is to show what the client sees.
        supabase
          .from("client_activity")
          .select("id, approval_id, kind, body, author_name, created_at")
          .eq("client_id", clientId)
          .in("kind", ["message", "client_message"])
          .order("created_at"),
      ]);

      if (clientRes.error) throw new Error(errorMessage(clientRes.error));
      if (contactRes.error) throw new Error(errorMessage(contactRes.error));
      if (itemRes.error) throw new Error(errorMessage(itemRes.error));
      if (threadRes.error) throw new Error(errorMessage(threadRes.error));

      const contacts: ReviewContact[] = (contactRes.data ?? [])
        .filter((c): c is { id: string; full_name: string } => !!c.full_name)
        .map((c) => ({ id: c.id, full_name: c.full_name }));

      const items: ReviewItem[] = (itemRes.data ?? []).map((r) => ({
        id: r.id,
        item_type: r.item_type as ReviewItem["item_type"],
        client_title: r.client_title,
        ask: r.ask,
        detail: r.detail,
        due_date: r.due_date,
        weighty: r.weighty,
        state: r.state as ReviewItem["state"],
        decided_at: r.decided_at,
        decided_by_name: r.decided_by_name,
        agreed_at: r.agreed_at,
        agreed_via: r.agreed_via,
        owed_by: r.owed_by === "us" ? ("us" as const) : ("client" as const),
        created_at: r.created_at,
        client_note: r.client_note,
        waiting_ms: waitingMsOf(r.briefs),
        // The preview is a faithful render of the client's screen, so the
        // thread has to be on it too — see the thread query below.
        messages: (threadRes.data ?? [])
          .filter((m) => m.approval_id === r.id)
          .map((m) => ({
            id: m.id,
            from: m.kind === "client_message" ? ("them" as const) : ("us" as const),
            author: m.kind === "client_message" ? m.author_name : null,
            body: m.body ?? "",
            at: m.created_at,
          })),
      }));

      return {
        status: "ok",
        company_name: clientRes.data?.name ?? "Unknown client",
        as_at: new Date().toISOString(),
        contacts,
        items,
        // Staff reach the preview by client id, not by anyone's link, so there
        // is nobody to be signed in as. The preview therefore shows the
        // company-wide shape — which is the honest thing: it cannot know which
        // person's link a given client will open.
        signed_in_as: null,
      };
    },
  });
}

/** Live (unrevoked) link count per client, so staff can see who can't get in. */
export function useLiveLinkCounts() {
  return useQuery({
    queryKey: ["client-review-link-counts"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("client_review_tokens")
        .select("client_id")
        .is("revoked_at", null);
      if (error) throw new Error(errorMessage(error));
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
      return counts;
    },
  });
}
