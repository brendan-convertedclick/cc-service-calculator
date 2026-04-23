import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type ResolvedRow = Database["public"]["Views"]["service_allocation_resolved"]["Row"];

export const ALLOCATION_MATRIX_KEY = ["allocation-matrix"] as const;

export type AllocationMatrix = {
  resolved: Record<string, Record<string, { pct: number | null; hours: number }>>;
  hasChecklist: Record<string, true>;
  childCounts: Record<string, number>;
};

export function useAllocationMatrix() {
  return useQuery({
    queryKey: ALLOCATION_MATRIX_KEY,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AllocationMatrix> => {
      const [
        { data: resolvedRows, error: rErr },
        { data: stepRows, error: sErr },
        { data: childRows, error: cErr },
      ] = await Promise.all([
        supabase.from("service_allocation_resolved").select("*"),
        supabase
          .from("process_steps")
          .select("service_id")
          .not("department_id", "is", null)
          .not("estimated_hours", "is", null),
        supabase.from("service_children").select("parent_id"),
      ]);
      if (rErr) throw rErr;
      if (sErr) throw sErr;
      if (cErr) throw cErr;

      const resolved: AllocationMatrix["resolved"] = {};
      for (const r of (resolvedRows as ResolvedRow[] | null) ?? []) {
        if (!r.service_id || !r.department_id) continue;
        const byDept = resolved[r.service_id] ?? (resolved[r.service_id] = {});
        byDept[r.department_id] = {
          pct: r.pct == null ? null : Number(r.pct),
          hours: Number(r.hours ?? 0),
        };
      }
      const hasChecklist: AllocationMatrix["hasChecklist"] = {};
      for (const s of ((stepRows as { service_id: string }[] | null) ?? [])) {
        hasChecklist[s.service_id] = true;
      }
      const childCounts: AllocationMatrix["childCounts"] = {};
      for (const row of ((childRows as { parent_id: string }[] | null) ?? [])) {
        childCounts[row.parent_id] = (childCounts[row.parent_id] ?? 0) + 1;
      }
      return { resolved, hasChecklist, childCounts };
    },
  });
}
