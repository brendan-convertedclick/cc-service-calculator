import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type ChildRow = Database["public"]["Tables"]["service_children"]["Row"];
type ChildInsert = Database["public"]["Tables"]["service_children"]["Insert"];

const KEY = (parentId: string) => ["service_children", parentId] as const;
const LIST = ["services"] as const;
const MATRIX = ["allocation-matrix"] as const;

export type ServiceChildWithChild = ChildRow & {
  child: {
    id: string;
    name: string;
    code: string | null;
    sell_price_cents: number;
    pricing_model: string;
  };
};

export function useServiceChildren(parentId: string | undefined) {
  return useQuery({
    enabled: !!parentId,
    queryKey: parentId ? KEY(parentId) : ["service_children", "none"],
    queryFn: async (): Promise<ServiceChildWithChild[]> => {
      if (!parentId) return [];
      const { data, error } = await supabase
        .from("service_children")
        .select("*, child:services!service_children_child_id_fkey(id, name, code, sell_price_cents, pricing_model)")
        .eq("parent_id", parentId)
        .order("ordinal");
      if (error) throw error;
      return (data ?? []) as ServiceChildWithChild[];
    },
  });
}

export function useAddServiceChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string }) => {
      const { data: existing, error: eErr } = await supabase
        .from("service_children")
        .select("ordinal")
        .eq("parent_id", input.parentId)
        .order("ordinal", { ascending: false })
        .limit(1);
      if (eErr) throw eErr;
      const nextOrdinal = existing && existing.length > 0 ? existing[0].ordinal + 1 : 1;

      const row: ChildInsert = {
        parent_id: input.parentId,
        child_id: input.childId,
        ordinal: nextOrdinal,
        quantity: 1,
      };
      const { data, error } = await supabase
        .from("service_children")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useUpdateServiceChildQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string; quantity: number }) => {
      const { error } = await supabase
        .from("service_children")
        .update({ quantity: input.quantity })
        .eq("parent_id", input.parentId)
        .eq("child_id", input.childId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useRemoveServiceChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; childId: string }) => {
      const { error } = await supabase
        .from("service_children")
        .delete()
        .eq("parent_id", input.parentId)
        .eq("child_id", input.childId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useReorderServiceChildren() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentId: string; orderedChildIds: string[] }) => {
      const BUMP = 100000;
      for (let i = 0; i < input.orderedChildIds.length; i++) {
        const { error } = await supabase
          .from("service_children")
          .update({ ordinal: BUMP + i })
          .eq("parent_id", input.parentId)
          .eq("child_id", input.orderedChildIds[i]);
        if (error) throw error;
      }
      for (let i = 0; i < input.orderedChildIds.length; i++) {
        const { error } = await supabase
          .from("service_children")
          .update({ ordinal: i + 1 })
          .eq("parent_id", input.parentId)
          .eq("child_id", input.orderedChildIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(vars.parentId) });
      qc.invalidateQueries({ queryKey: LIST });
      qc.invalidateQueries({ queryKey: MATRIX });
    },
  });
}

export function useServiceAncestors(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: serviceId ? ["service_ancestors", serviceId] : ["service_ancestors", "none"],
    queryFn: async (): Promise<Set<string>> => {
      if (!serviceId) return new Set();
      const { data, error } = await supabase.from("service_children").select("parent_id, child_id");
      if (error) throw error;
      const rows = (data ?? []) as { parent_id: string; child_id: string }[];
      const childToParents = new Map<string, string[]>();
      for (const r of rows) {
        const arr = childToParents.get(r.child_id) ?? [];
        arr.push(r.parent_id);
        childToParents.set(r.child_id, arr);
      }
      const ancestors = new Set<string>();
      const stack = [serviceId];
      while (stack.length) {
        const cur = stack.pop()!;
        const parents = childToParents.get(cur) ?? [];
        for (const p of parents) {
          if (!ancestors.has(p)) {
            ancestors.add(p);
            stack.push(p);
          }
        }
      }
      return ancestors;
    },
  });
}
