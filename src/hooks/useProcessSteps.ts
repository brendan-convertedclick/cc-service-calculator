import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";
import { SERVICES_LIST_KEY, SERVICE_DETAIL_KEY } from "@/hooks/useServices";
import { ALLOCATION_MATRIX_KEY } from "@/hooks/useAllocationMatrix";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type StepInsert = Database["public"]["Tables"]["process_steps"]["Insert"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

// service_id is nullable since 0105 (a step can belong to a system instead).
// C3 fix: a mutated row's scope (service_id or system_id) isn't reliably known
// at the call site (e.g. useDeleteStep only has the id), and a backfilled step
// carries BOTH — so mutations invalidate the ["process_steps"] PREFIX rather
// than a specific scope id. TanStack v5 invalidateQueries does partial/prefix
// matching by default, so this refreshes every process_steps query (both
// useProcessSteps and useSystemSteps below) regardless of which scope id the
// caller mutated on.
const ROOT_KEY = ["process_steps"] as const;
const KEY = (scopeId: string | null) => [...ROOT_KEY, scopeId ?? "none"] as const;

export function useProcessSteps(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: KEY(serviceId ?? null),
    queryFn: async (): Promise<Step[]> => {
      if (!serviceId) return [];
      const { data, error } = await supabase
        .from("process_steps")
        .select("*")
        .eq("service_id", serviceId)
        .is("parent_id", null) // top-level only — sub-steps have no hours and render as their step's checklist, not a row here
        .order("ordinal");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Steps that belong to a system (kind='service'/'recurring'/'internal'/'reference')
// instead of directly to a service — needed by the /systems detail UI (P4).
export function useSystemSteps(systemId: string | undefined) {
  return useQuery({
    enabled: !!systemId,
    queryKey: KEY(systemId ?? null),
    queryFn: async (): Promise<Step[]> => {
      if (!systemId) return [];
      const { data, error } = await supabase
        .from("process_steps")
        .select("*")
        .eq("system_id", systemId)
        .is("parent_id", null)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
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
      // Scoped to top-level steps: cascade (process_steps_parent_id_fkey) takes
      // their sub-steps with them, which is the intended full-replace behaviour.
      const { error: dErr } = await supabase
        .from("process_steps")
        .delete()
        .eq("service_id", serviceId)
        .is("parent_id", null);
      if (dErr) throw dErr;
      if (steps.length > 0) {
        const { error: iErr } = await supabase
          .from("process_steps")
          .insert(steps.map((s) => ({ ...s, service_id: serviceId })));
        if (iErr) throw iErr;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
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
      // Always delete existing top-level steps for the service first; cascade
      // (process_steps_parent_id_fkey) takes their sub-steps with them.
      const { error: dErr } = await supabase
        .from("process_steps")
        .delete()
        .eq("service_id", input.serviceId)
        .is("parent_id", null);
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
      qc.invalidateQueries({ queryKey: ROOT_KEY });
    },
  });
}
