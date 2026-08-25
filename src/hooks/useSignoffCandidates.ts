// src/hooks/useSignoffCandidates.ts
//
// The bridge between the signal we already have and the sign-off inbox.
//
// ClickUp has a "waiting on client" status and the team already uses it — a
// dozen briefs sit in it right now. Those are, by definition, the items a
// client owes us a decision on, and until this hook existed none of them
// reached the client sign-off page.
//
// This finds them. It does NOT create anything on its own: a client_title is
// written by a person, because raw_subject is unusable in front of a client
// and no regex can decide what an item means to the reader.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/utils";
import { suggestClientTitle } from "@/lib/client-title";

/** The ClickUp statuses that mean the ball is in the client's court. */
export const WAITING_STATUSES = ["waiting on client", "send to client"] as const;

export type SignoffCandidate = {
  briefId: string;
  clientId: string;
  clientName: string;
  rawSubject: string;
  /** Cleaned starting point for the client-facing title. Always editable. */
  suggestedTitle: string;
  dueDate: string | null;
  clickupStatus: string | null;
};

/**
 * Briefs sitting in a waiting-on-client ClickUp status that do not already
 * have a sign-off row. Excluding the ones already sent is what makes this
 * safe to run repeatedly — no duplicates, no "did I already do this?".
 */
export function useSignoffCandidates() {
  return useQuery({
    queryKey: ["signoff-candidates"],
    queryFn: async (): Promise<SignoffCandidate[]> => {
      const [briefRes, existingRes] = await Promise.all([
        supabase
          .from("briefs")
          .select("id, client_id, raw_subject, original_due_date, clickup_task_status, clients!inner(name)")
          .is("completed_at", null)
          .not("client_id", "is", null)
          .in("clickup_task_status", [...WAITING_STATUSES]),
        supabase.from("client_approvals").select("brief_id").not("brief_id", "is", null),
      ]);

      if (briefRes.error) throw new Error(errorMessage(briefRes.error));
      if (existingRes.error) throw new Error(errorMessage(existingRes.error));

      const already = new Set((existingRes.data ?? []).map((r) => r.brief_id));

      return (briefRes.data ?? [])
        .filter((b) => !already.has(b.id))
        .map((b) => {
          const clientName = (b as typeof b & { clients: { name: string } | null }).clients?.name ?? "";
          return {
            briefId: b.id,
            clientId: b.client_id as string,
            clientName,
            rawSubject: b.raw_subject ?? "",
            suggestedTitle: suggestClientTitle(b.raw_subject, clientName),
            dueDate: b.original_due_date,
            clickupStatus: b.clickup_task_status,
          };
        })
        .sort(
          (a, b) =>
            a.clientName.localeCompare(b.clientName) ||
            (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
        );
    },
  });
}

export type SignoffDraft = {
  briefId: string;
  clientId: string;
  clientTitle: string;
  ask: string;
  dueDate: string | null;
};

/**
 * Create several sign-offs at once, after a human has read every title.
 * One insert so a failure leaves nothing half-created.
 */
export function useCreateSignoffs() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();
  return useMutation({
    mutationFn: async (drafts: SignoffDraft[]): Promise<number> => {
      if (drafts.length === 0) return 0;
      const rows = drafts.map((d) => ({
        brief_id: d.briefId,
        client_id: d.clientId,
        client_title: d.clientTitle.trim(),
        ask: d.ask.trim(),
        due_date: d.dueDate,
        created_by: currentUserId ?? null,
      }));
      const { error } = await supabase.from("client_approvals").insert(rows);
      if (error) throw new Error(errorMessage(error));
      return rows.length;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["signoff-candidates"] });
      void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
      void qc.invalidateQueries({ queryKey: ["client-review-preview"] });
    },
  });
}
