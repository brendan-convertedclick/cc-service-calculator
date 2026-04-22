import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Settings = Database["public"]["Tables"]["settings"]["Row"];
type SettingsUpdate = Database["public"]["Tables"]["settings"]["Update"];

const KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsUpdate) => {
      const { data, error } = await supabase
        .from("settings").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
