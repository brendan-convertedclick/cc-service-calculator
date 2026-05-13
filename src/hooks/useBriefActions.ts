import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ── Assignee ──────────────────────────────────────────────────────────────────

export function useUpdateBriefAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ briefId, assigneeId }: { briefId: string; assigneeId: string | null }) => {
      const { error } = await supabase
        .from("briefs")
        .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
        .eq("id", briefId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["briefs"] }),
  });
}

// ── Internal note ─────────────────────────────────────────────────────────────

export function useAddInternalNote(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, authorEmail }: { body: string; authorEmail: string }) => {
      const syntheticId = `note-${crypto.randomUUID()}`;
      const { error } = await supabase.from("brief_messages").insert({
        brief_id: briefId,
        gmail_message_id: syntheticId,
        direction: "note",
        body_text: body,
        relayed_by: authorEmail,
        sent_at: new Date().toISOString(),
        to_emails: [],
        cc_emails: [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief_messages", briefId] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}

// ── Downstream link ───────────────────────────────────────────────────────────

export type DownstreamLink =
  | { kind: "scope"; id: string; label: string }
  | { kind: "quote"; id: string; label: string }
  | { kind: "project"; id: string; label: string }
  | { kind: "none" };

// Roll back the brief one stage. `from: "quote"` deletes the live + superseded
// quote(s) for the brief's scope and sets status='scoped'. `from: "scope"` does
// the same and also deletes the scope, setting status='new'. Refuses if any
// quote on the scope has already been turned into a project (ClickUp push).
export function useRollbackBriefStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ briefId, from }: { briefId: string; from: "quote" | "scope" }) => {
      const { data: scope } = await supabase
        .from("scopes")
        .select("id")
        .eq("brief_id", briefId)
        .maybeSingle();

      if (scope) {
        const { data: quotes } = await supabase
          .from("quotes")
          .select("id")
          .eq("scope_id", scope.id);
        const quoteIds = (quotes ?? []).map((q) => q.id);

        if (quoteIds.length > 0) {
          const { data: project } = await supabase
            .from("projects")
            .select("id")
            .in("quote_id", quoteIds)
            .maybeSingle();
          if (project) {
            throw new Error(
              "Cannot delete: a project has already been created from this quote.",
            );
          }
          const { error: dqErr } = await supabase
            .from("quotes")
            .delete()
            .in("id", quoteIds);
          if (dqErr) throw dqErr;
        }

        if (from === "scope") {
          const { error: dsErr } = await supabase
            .from("scopes")
            .delete()
            .eq("id", scope.id);
          if (dsErr) throw dsErr;
        }
      }

      const nextStatus = from === "quote" ? "scoped" : "new";
      const { error } = await supabase
        .from("briefs")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", briefId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["brief_downstream", vars.briefId] });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}

export function useBriefDownstream(briefId: string | undefined) {
  return useQuery({
    enabled: !!briefId,
    queryKey: ["brief_downstream", briefId],
    queryFn: async (): Promise<DownstreamLink> => {
      if (!briefId) return { kind: "none" };

      const { data: scope } = await supabase
        .from("scopes")
        .select("id")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (!scope) return { kind: "none" };

      const { data: quote } = await supabase
        .from("quotes")
        .select("id, status")
        .eq("scope_id", scope.id)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!quote) return { kind: "scope", id: scope.id, label: "Scope" };

      const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("quote_id", quote.id)
        .maybeSingle();
      if (project) return { kind: "project", id: project.id, label: project.name ?? "Project" };

      return { kind: "quote", id: quote.id, label: "Quote" };
    },
    staleTime: 60_000,
  });
}
