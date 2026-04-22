import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type DepartmentInsert = Database["public"]["Tables"]["departments"]["Insert"];
type DepartmentUpdate = Database["public"]["Tables"]["departments"]["Update"];

const KEY = ["departments"] as const;

export function useDepartments() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Department[]> => {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .is("archived_at", null)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DepartmentInsert) => {
      const { data, error } = await supabase.from("departments").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DepartmentUpdate }) => {
      const { data, error } = await supabase.from("departments").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
