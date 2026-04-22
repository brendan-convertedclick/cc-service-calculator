import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Quote = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];
type QuoteUpdate = Database["public"]["Tables"]["quotes"]["Update"];
type QuoteService = Database["public"]["Tables"]["quote_services"]["Row"];
type QuoteServiceInsert = Database["public"]["Tables"]["quote_services"]["Insert"];

const Q_DETAIL = (id: string) => ["quote", id] as const;
const Q_BY_SCOPE = (scopeId: string) => ["quote", "by-scope", scopeId] as const;

export function useQuote(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? Q_DETAIL(id) : ["quote", "none"],
    queryFn: async (): Promise<{ quote: Quote; services: QuoteService[] } | null> => {
      if (!id) return null;
      const [{ data: quote, error: qErr }, { data: svcs, error: sErr }] = await Promise.all([
        supabase.from("quotes").select("*").eq("id", id).single(),
        supabase.from("quote_services").select("*").eq("quote_id", id).order("ordinal"),
      ]);
      if (qErr) throw qErr;
      if (sErr) throw sErr;
      return { quote, services: svcs ?? [] };
    },
  });
}

export function useLiveQuoteForScope(scopeId: string | undefined) {
  return useQuery({
    enabled: !!scopeId,
    queryKey: scopeId ? Q_BY_SCOPE(scopeId) : ["quote", "by-scope", "none"],
    queryFn: async (): Promise<Quote | null> => {
      if (!scopeId) return null;
      const { data, error } = await supabase
        .from("quotes").select("*")
        .eq("scope_id", scopeId).neq("status", "superseded")
        .order("version", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuoteInsert) => {
      const { data, error } = await supabase.from("quotes").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: Q_BY_SCOPE(d.scope_id) });
      qc.invalidateQueries({ queryKey: Q_DETAIL(d.id) });
    },
  });
}

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: QuoteUpdate }) => {
      const { data, error } = await supabase
        .from("quotes").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: Q_DETAIL(d.id) });
      qc.invalidateQueries({ queryKey: Q_BY_SCOPE(d.scope_id) });
    },
  });
}

export function useReplaceQuoteServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ quoteId, rows }: { quoteId: string; rows: Omit<QuoteServiceInsert, "quote_id">[] }) => {
      const { error: dErr } = await supabase.from("quote_services").delete().eq("quote_id", quoteId);
      if (dErr) throw dErr;
      if (rows.length === 0) return;
      const { error: iErr } = await supabase
        .from("quote_services")
        .insert(rows.map((r) => ({ ...r, quote_id: quoteId })));
      if (iErr) throw iErr;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: Q_DETAIL(vars.quoteId) }),
  });
}
