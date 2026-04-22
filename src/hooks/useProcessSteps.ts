import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

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
