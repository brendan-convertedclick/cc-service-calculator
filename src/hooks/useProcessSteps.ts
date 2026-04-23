import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";
import { SERVICES_LIST_KEY, SERVICE_DETAIL_KEY } from "@/hooks/useServices";
import { ALLOCATION_MATRIX_KEY } from "@/hooks/useAllocationMatrix";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type StepInsert = Database["public"]["Tables"]["process_steps"]["Insert"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

const KEY = (serviceId: string) => ["process_steps", serviceId] as const;

export function useProcessSteps(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: serviceId ? KEY(serviceId) : ["process_steps", "none"],
    queryFn: async (): Promise<Step[]> => {
      if (!serviceId) return [];
      const { data, error } = await supabase
        .from("process_steps")
        .select("*")
        .eq("service_id", serviceId)
        .order("ordinal");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StepInsert) => {
      const { data, error } = await supabase.from("process_steps").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: KEY(d.service_id) }),
  });
}

export function useUpdateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: StepUpdate }) => {
      const { data, error } = await supabase.from("process_steps").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: KEY(d.service_id) }),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, serviceId }: { id: string; serviceId: string }) => {
      const { error } = await supabase.from("process_steps").delete().eq("id", id);
      if (error) throw error;
      return serviceId;
    },
    onSuccess: (serviceId) => qc.invalidateQueries({ queryKey: KEY(serviceId) }),
  });
}

export function useReplaceSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceId,
      steps,
    }: {
      serviceId: string;
      steps: Omit<StepInsert, "service_id">[];
    }) => {
      const { error: dErr } = await supabase.from("process_steps").delete().eq("service_id", serviceId);
      if (dErr) throw dErr;
      if (steps.length > 0) {
        const { error: iErr } = await supabase
          .from("process_steps")
          .insert(steps.map((s) => ({ ...s, service_id: serviceId })));
        if (iErr) throw iErr;
      }
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: KEY(vars.serviceId) }),
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
      qc.invalidateQueries({ queryKey: SERVICES_LIST_KEY });
      qc.invalidateQueries({ queryKey: SERVICE_DETAIL_KEY(vars.serviceId) });
      qc.invalidateQueries({ queryKey: ALLOCATION_MATRIX_KEY });
      qc.invalidateQueries({ queryKey: KEY(vars.serviceId) });
    },
  });
}
