import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type ServiceInsert = Database["public"]["Tables"]["services"]["Insert"];
type ServiceUpdate = Database["public"]["Tables"]["services"]["Update"];
type ResolvedRow = Database["public"]["Views"]["service_allocation_resolved"]["Row"];
type TotalsRow = Database["public"]["Views"]["service_totals"]["Row"];
type Override = Database["public"]["Tables"]["service_allocation_overrides"]["Row"];

const LIST = ["services"] as const;
const DETAIL = (id: string) => ["services", id] as const;
const MATRIX = ["allocation-matrix"] as const;

export type ServiceWithTotals = Service & {
  total_hours: number;
  total_price_cents: number;
};

export function useServices() {
  return useQuery({
    queryKey: LIST,
    queryFn: async (): Promise<ServiceWithTotals[]> => {
      const { data: services, error } = await supabase
        .from("services")
        .select("*")
        .order("name");
      if (error) throw error;

      const { data: totals, error: tErr } = await supabase.from("service_totals").select("*");
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
    queryKey: id ? DETAIL(id) : ["services", "none"],
    queryFn: async () => {
      if (!id) return null;
      const { data: service, error } = await supabase
        .from("services")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const { data: resolved } = await supabase
        .from("service_allocation_resolved")
        .select("*")
        .eq("service_id", id);

      const { data: overrides } = await supabase
        .from("service_allocation_overrides")
        .select("*")
        .eq("service_id", id);

      return {
        service,
        resolved: (resolved as ResolvedRow[] | null) ?? [],
        overrides: (overrides as Override[] | null) ?? [],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
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
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: DETAIL(vars.id) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

type ChecklistInput =
  | { kind: "hours"; serviceId: string; hoursByDept: Record<string, number>; departmentOrder: string[] }
  | { kind: "steps"; serviceId: string; steps: {
        ordinal: number;
        title: string;
        description: string | null;
        department_id: string | null;
        estimated_hours: number | null;
        ai_generated: boolean;
      }[] }
  | { kind: "clear"; serviceId: string };

export function useSetServiceChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChecklistInput) => {
      // Always delete existing steps for the service first
      const { error: dErr } = await supabase
        .from("process_steps")
        .delete()
        .eq("service_id", input.serviceId);
      if (dErr) throw dErr;

      if (input.kind === "clear") return;

      if (input.kind === "hours") {
        // Build one step per dept with non-zero hours, in display order
        const rows = input.departmentOrder
          .map((dept_id, i) => ({
            service_id: input.serviceId,
            ordinal: i + 1,
            title: "Department work",
            description: null,
            department_id: dept_id,
            estimated_hours: input.hoursByDept[dept_id] ?? 0,
            ai_generated: false,
          }))
          .filter((r) => (r.estimated_hours ?? 0) >= 0.25);

        if (rows.length === 0) return;

        const { error: iErr } = await supabase.from("process_steps").insert(rows);
        if (iErr) throw iErr;
        return;
      }

      // kind === "steps"
      if (input.steps.length > 0) {
        const { error: iErr } = await supabase
          .from("process_steps")
          .insert(
            input.steps.map((s) => ({
              service_id: input.serviceId,
              ordinal: s.ordinal,
              title: s.title,
              description: s.description,
              department_id: s.department_id,
              estimated_hours: s.estimated_hours,
              ai_generated: s.ai_generated,
            }))
          );
        if (iErr) throw iErr;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: DETAIL(vars.serviceId) });
      qc.invalidateQueries({ queryKey: MATRIX });
      qc.invalidateQueries({ queryKey: ["process_steps", vars.serviceId] });
    },
  });
}

export type AllocationMatrix = {
  resolved: Map<string, Map<string, { pct: number | null; hours: number }>>;
  hasChecklist: Set<string>;
};

export function useAllocationMatrix() {
  return useQuery({
    queryKey: MATRIX,
    queryFn: async (): Promise<AllocationMatrix> => {
      const [{ data: resolvedRows, error: rErr }, { data: stepRows, error: sErr }] = await Promise.all([
        supabase.from("service_allocation_resolved").select("*"),
        supabase
          .from("process_steps")
          .select("service_id")
          .not("department_id", "is", null)
          .not("estimated_hours", "is", null),
      ]);
      if (rErr) throw rErr;
      if (sErr) throw sErr;

      const resolved = new Map<string, Map<string, { pct: number | null; hours: number }>>();
      for (const r of (resolvedRows as ResolvedRow[] | null) ?? []) {
        if (!r.service_id || !r.department_id) continue;
        let byDept = resolved.get(r.service_id);
        if (!byDept) {
          byDept = new Map();
          resolved.set(r.service_id, byDept);
        }
        byDept.set(r.department_id, {
          pct: r.pct == null ? null : Number(r.pct),
          hours: Number(r.hours ?? 0),
        });
      }
      const hasChecklist = new Set<string>(
        ((stepRows as { service_id: string }[] | null) ?? []).map((s) => s.service_id)
      );
      return { resolved, hasChecklist };
    },
  });
}
