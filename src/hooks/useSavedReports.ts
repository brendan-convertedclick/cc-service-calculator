// src/hooks/useSavedReports.ts
//
// Named, bookmarkable Reports views (client + billing period). A saved report is
// just a stored {client_id, period_start, period_end} under a name; loading one
// sets the Reports URL params, so it composes with the bookmarkable-URL state.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// saved_reports isn't in the generated Database types yet — query untyped.
const sb = supabase as unknown as SupabaseClient;

import type { ReportType } from "@/lib/report-types";

export interface SavedReport {
  id: string;
  name: string;
  client_id: string;
  period_start: string; // "YYYY-MM-DD"
  period_end: string; // "YYYY-MM-DD"
  report_type: ReportType;
  created_at: string;
  client_name: string | null; // resolved from clients (short_name ?? name)
}

const KEY = ["saved-reports"];

export function useSavedReports() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SavedReport[]> => {
      const { data, error } = await sb
        .from("saved_reports")
        .select(
          "id, name, client_id, period_start, period_end, report_type, created_at, clients(name, short_name)",
        )
        .order("name", { ascending: true });
      if (error) throw error;
      type Row = Omit<SavedReport, "client_name"> & {
        clients: { name: string | null; short_name: string | null } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        name: r.name,
        client_id: r.client_id,
        period_start: r.period_start,
        period_end: r.period_end,
        report_type: (r.report_type ?? "scorecard") as ReportType,
        created_at: r.created_at,
        client_name: r.clients?.short_name ?? r.clients?.name ?? null,
      }));
    },
  });
}

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      name: string;
      client_id: string;
      period_start: string;
      period_end: string;
      report_type: ReportType;
      created_by?: string | null;
    }) => {
      const { error } = await sb.from("saved_reports").insert({
        name: args.name,
        client_id: args.client_id,
        period_start: args.period_start,
        period_end: args.period_end,
        report_type: args.report_type,
        created_by: args.created_by ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("saved_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
