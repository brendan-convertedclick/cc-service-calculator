import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type ServiceInsert = Database["public"]["Tables"]["services"]["Insert"];
type ServiceUpdate = Database["public"]["Tables"]["services"]["Update"];
type ResolvedRow = Database["public"]["Views"]["service_allocation_resolved"]["Row"];
type TotalsRow = Database["public"]["Views"]["service_totals"]["Row"];

export const SERVICES_LIST_KEY = ["services"] as const;
export const SERVICE_DETAIL_KEY = (id: string) => ["services", id] as const;

export type ServiceWithTotals = Service & {
  total_hours: number;
  total_price_cents: number;
};

export function useServices() {
  return useQuery({
    queryKey: SERVICES_LIST_KEY,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ServiceWithTotals[]> => {
      const [{ data: services, error }, { data: totals, error: tErr }] = await Promise.all([
        supabase.from("services").select("*").order("name"),
        supabase.from("service_totals").select("*"),
      ]);
      if (error) throw error;
      if (tErr) throw tErr;

      const totalsMap = new Map(
        (totals as TotalsRow[] | null ?? []).map((t) => [t.service_id, t])
      );

      return (services ?? []).map((s) => {
        const t = totalsMap.get(s.id);
        return {
          ...s,
          total_hours: Number(t?.total_hours ?? 0),
          total_price_cents: Number(t?.total_price_cents ?? 0),
        };
      });
    },
  });
}

export function useService(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: id ? SERVICE_DETAIL_KEY(id) : ["services", "none"],
    staleTime: 60_000,
    queryFn: async () => {
      if (!id) return null;
      const { data: service, error } = await supabase
        .from("services")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const { data: resolved, error: resolvedErr } = await supabase
        .from("service_allocation_resolved")
        .select("*")
        .eq("service_id", id);
      if (resolvedErr) throw resolvedErr;

      return {
        service,
        resolved: (resolved as ResolvedRow[] | null) ?? [],
      };
    },
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInsert) => {
      const { data, error } = await supabase.from("services").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICES_LIST_KEY }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ServiceUpdate }) => {
      const { data, error } = await supabase.from("services").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SERVICES_LIST_KEY });
      qc.invalidateQueries({ queryKey: SERVICE_DETAIL_KEY(vars.id) });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICES_LIST_KEY }),
  });
}
