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

/** One row of the cross-client queue, for the aggregate table and rail counts. */
export type SignoffRow = ReviewItem & {
  client_id: string;
  client_name: string;
  created_at: string;
};

const ITEM_COLUMNS =
  "id, client_id, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name, created_at";

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
        .select(`${ITEM_COLUMNS}, clients!inner(name)`)
        .order("created_at", { ascending: false });
      if (error) throw new Error(errorMessage(error));

      return (data ?? []).map((r) => {
        const { clients, ...rest } = r as typeof r & { clients: { name: string } | null };
        return {
          ...(rest as Omit<SignoffRow, "client_name">),
          client_name: clients?.name ?? "Unknown client",
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

      const [clientRes, contactRes, itemRes] = await Promise.all([
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
      ]);

      if (clientRes.error) throw new Error(errorMessage(clientRes.error));
      if (contactRes.error) throw new Error(errorMessage(contactRes.error));
      if (itemRes.error) throw new Error(errorMessage(itemRes.error));

      const contacts: ReviewContact[] = (contactRes.data ?? [])
        .filter((c): c is { id: string; full_name: string } => !!c.full_name)
        .map((c) => ({ id: c.id, full_name: c.full_name }));

      const items: ReviewItem[] = (itemRes.data ?? []).map((r) => ({
        id: r.id,
        client_title: r.client_title,
        ask: r.ask,
        detail: r.detail,
        due_date: r.due_date,
        weighty: r.weighty,
        state: r.state as ReviewItem["state"],
        decided_at: r.decided_at,
        decided_by_name: r.decided_by_name,
      }));

      return {
        status: "ok",
        company_name: clientRes.data?.name ?? "Unknown client",
        as_at: new Date().toISOString(),
        contacts,
        items,
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
