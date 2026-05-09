import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function useInboxBriefs() {
  return useQuery({
    queryKey: ["briefs", "inbox"],
    queryFn: async (): Promise<Brief[]> => {
      const { data, error } = await supabase
        .from("briefs")
        .select("*")
        .is("parent_project_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
