import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";
import type { SnapshotLineItem } from "@/lib/quotes";

type Quote = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];
type QuoteUpdate = Database["public"]["Tables"]["quotes"]["Update"];
type QuoteService = Database["public"]["Tables"]["quote_services"]["Row"];

export type QuoteServiceWithOverrides = QuoteService & {
  allocation_override: Record<string, number>;
  hours_override: Record<string, number>;
};

const Q_DETAIL = (id: string) => ["quote", id] as const;
const Q_BY_SCOPE = (scopeId: string) => ["quote", "by-scope", scopeId] as const;

export function useQuote(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? Q_DETAIL(id) : ["quote", "none"],
    queryFn: async (): Promise<{ quote: Quote; services: QuoteServiceWithOverrides[] } | null> => {
      if (!id) return null;
      const [{ data: quote, error: qErr }, { data: svcs, error: sErr }] = await Promise.all([
        supabase.from("quotes").select("*").eq("id", id).single(),
        supabase
          .from("quote_services")
          .select("*, overrides:quote_service_overrides(*)")
          .eq("quote_id", id)
          .order("ordinal"),
      ]);
      if (qErr) throw qErr;
      if (sErr) throw sErr;

      const services: QuoteServiceWithOverrides[] = (svcs ?? []).map((s) => {
        const row = s as QuoteService & {
          overrides: Array<{
            dept_id: string;
            pct_override: number | null;
            hours_override: number | null;
          }>;
        };
        const overrides = row.overrides ?? [];
        const allocation_override: Record<string, number> = {};
        const hours_override: Record<string, number> = {};
        for (const o of overrides) {
          if (o.pct_override != null) allocation_override[o.dept_id] = Number(o.pct_override);
          if (o.hours_override != null) hours_override[o.dept_id] = Number(o.hours_override);
        }
        // strip the embedded overrides array; only the flattened maps survive
        const { overrides: _drop, ...rest } = row;
        void _drop;
        return { ...rest, allocation_override, hours_override };
      });

      return { quote, services };
    },
  });
}

// An accepted quote belonging to a client, with its service lines — used to
// prefill the New Retainer wizard ("start from quote"). Quotes don't carry a
// client_id directly, so we walk client → briefs → scopes → quotes(accepted).
export type ImportableQuoteLine = { service_id: string; qty: number };
export type ImportableQuote = {
  id: string;
  version: number;
  total_cents: number;
  accepted_at: string | null;
  lines: ImportableQuoteLine[];
};

export function useClientAcceptedQuotes(clientId: string | null) {
  return useQuery({
    enabled: !!clientId,
    queryKey: ["clientAcceptedQuotes", clientId] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<ImportableQuote[]> => {
      if (!clientId) return [];

      const { data: briefs, error: bErr } = await supabase
        .from("briefs").select("id").eq("client_id", clientId);
      if (bErr) throw bErr;
      const briefIds = (briefs ?? []).map((b) => b.id);
      if (briefIds.length === 0) return [];

      const { data: scopes, error: sErr } = await supabase
        .from("scopes").select("id").in("brief_id", briefIds);
      if (sErr) throw sErr;
      const scopeIds = (scopes ?? []).map((s) => s.id);
      if (scopeIds.length === 0) return [];

      const { data: quotes, error: qErr } = await supabase
        .from("quotes")
        .select("id, version, total_cents, accepted_at, quote_services(service_id, qty)")
        .in("scope_id", scopeIds)
        .eq("status", "accepted")
        .order("accepted_at", { ascending: false });
      if (qErr) throw qErr;

      return (quotes ?? []).map((q) => {
        const row = q as typeof q & {
          quote_services: Array<{ service_id: string; qty: number }> | null;
        };
        return {
          id: row.id,
          version: row.version,
          total_cents: Number(row.total_cents ?? 0),
          accepted_at: row.accepted_at,
          lines: (row.quote_services ?? []).map((l) => ({
            service_id: l.service_id,
            qty: Number(l.qty) || 1,
          })),
        };
      });
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

export type ReplaceQuoteServiceRow = {
  service_id: string;
  qty: number;
  unit_price_override_cents?: number | null;
  ordinal: number;
  notes: string | null;
  allocation_override: Record<string, number>;
  hours_override: Record<string, number>;
  is_recurring?: boolean;
  recurrence_interval?: Database["public"]["Enums"]["recurrence_interval"] | null;
  recurrence_start?: string | null;
  recurrence_end?: string | null;
};

export function useReplaceQuoteServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      quoteId,
      rows,
    }: {
      quoteId: string;
      rows: ReplaceQuoteServiceRow[];
    }) => {
      // delete cascades to quote_service_overrides via FK
      const { error: dErr } = await supabase.from("quote_services").delete().eq("quote_id", quoteId);
      if (dErr) throw dErr;
      if (rows.length === 0) return;

      // insert quote_services WITHOUT the override maps
      const insertPayload = rows.map((r) => ({
        quote_id: quoteId,
        service_id: r.service_id,
        qty: r.qty,
        unit_price_override_cents: r.unit_price_override_cents ?? null,
        ordinal: r.ordinal,
        notes: r.notes,
        is_recurring: r.is_recurring ?? false,
        recurrence_interval: r.recurrence_interval ?? null,
        recurrence_start: r.recurrence_start ?? null,
        recurrence_end: r.recurrence_end ?? null,
      }));
      const { data: inserted, error: iErr } = await supabase
        .from("quote_services")
        .insert(insertPayload)
        .select("id, ordinal");
      if (iErr) throw iErr;

      // build per-(quote_service, dept) override rows
      const overrideRows = (inserted ?? []).flatMap((qs) => {
        const input = rows.find((r) => r.ordinal === qs.ordinal);
        if (!input) return [];
        const deptIds = new Set<string>([
          ...Object.keys(input.allocation_override ?? {}),
          ...Object.keys(input.hours_override ?? {}),
        ]);
        return Array.from(deptIds).map((dept_id) => ({
          quote_service_id: qs.id,
          dept_id,
          pct_override: input.allocation_override?.[dept_id] ?? null,
          hours_override: input.hours_override?.[dept_id] ?? null,
        }));
      });

      if (overrideRows.length > 0) {
        const { error: oErr } = await supabase.from("quote_service_overrides").insert(overrideRows);
        if (oErr) throw oErr;
      }
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: Q_DETAIL(vars.quoteId) }),
  });
}

// Replace the frozen line-item snapshot on a quote. Called from Finalise. The
// table is the source of truth for what was accepted — push-to-clickup and
// any future reporting read from it directly, never from catalogue joins.
export function useReplaceQuoteLineItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      quoteId,
      snapshot,
    }: {
      quoteId: string;
      snapshot: SnapshotLineItem[];
    }) => {
      const { error: dErr } = await supabase
        .from("quote_line_item_allocations")
        .delete()
        .eq("quote_id", quoteId);
      if (dErr) throw dErr;

      if (snapshot.length === 0) return;

      const rows = snapshot.flatMap((line, idx) =>
        line.allocation.map((alloc) => ({
          quote_id: quoteId,
          ordinal: idx + 1,
          service_id: line.service_id,
          service_name: line.service_name,
          xero_code: line.xero_code,
          qty: line.qty,
          unit_price_cents: line.unit_price_cents,
          subtotal_cents: line.subtotal_cents,
          dept_id: alloc.dept_id,
          dept_name: alloc.dept_name,
          hours: alloc.hours,
          cost_share_cents: alloc.cost_share_cents,
        })),
      );

      const { error: iErr } = await supabase
        .from("quote_line_item_allocations")
        .insert(rows);
      if (iErr) throw iErr;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: Q_DETAIL(vars.quoteId) }),
  });
}
