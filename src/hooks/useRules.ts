import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Rule = Database["public"]["Tables"]["rules"]["Row"];
type RuleAllocation = Database["public"]["Tables"]["rule_allocations"]["Row"];

export type RuleWithAllocations = Rule & { allocations: RuleAllocation[] };

const KEY = ["rules"] as const;

export function useRules() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<RuleWithAllocations[]> => {
      const { data: rules, error } = await supabase
        .from("rules")
        .select("*")
        .is("archived_at", null)
        .order("name");
      if (error) throw error;

      const { data: allocs, error: aErr } = await supabase.from("rule_allocations").select("*");
      if (aErr) throw aErr;

      return (rules ?? []).map((r) => ({
        ...r,
        allocations: (allocs ?? []).filter((a) => a.rule_id === r.id),
      }));
    },
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      description,
      allocations,
    }: {
      name: string;
      description?: string | null;
      allocations: { department_id: string; pct: number }[];
    }) => {
      const { data: rule, error } = await supabase
        .from("rules")
        .insert({ name, description: description ?? null })
        .select()
        .single();
      if (error) throw error;
      if (allocations.length > 0) {
        const { error: aErr } = await supabase
          .from("rule_allocations")
          .insert(allocations.map((a) => ({ ...a, rule_id: rule.id })));
        if (aErr) throw aErr;
      }
      return rule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      description,
      allocations,
    }: {
      id: string;
      name?: string;
      description?: string | null;
      allocations?: { department_id: string; pct: number }[];
    }) => {
      if (name !== undefined || description !== undefined) {
        const patch: Database["public"]["Tables"]["rules"]["Update"] = {};
        if (name !== undefined) patch.name = name;
        if (description !== undefined) patch.description = description;
        const { error } = await supabase.from("rules").update(patch).eq("id", id);
        if (error) throw error;
      }
      if (allocations) {
        // Replace the set in one transaction: delete then insert.
        const { error: dErr } = await supabase.from("rule_allocations").delete().eq("rule_id", id);
        if (dErr) throw dErr;
        if (allocations.length > 0) {
          const { error: iErr } = await supabase
            .from("rule_allocations")
            .insert(allocations.map((a) => ({ ...a, rule_id: id })));
          if (iErr) throw iErr;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rules").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
