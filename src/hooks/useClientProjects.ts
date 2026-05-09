import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type Project = Database["public"]["Tables"]["projects"]["Row"];

export type ClientWithProjects = Client & {
  projects: Project[];
};

export function useClientProjects() {
  return useQuery({
    queryKey: ["clients", "withProjects"],
    queryFn: async (): Promise<ClientWithProjects[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select(`*, projects (*)`)
        .is("archived_at", null)
        .order("name")
        .order("started_at", { ascending: false, referencedTable: "projects" });

      if (error) throw error;
      return (data ?? []) as ClientWithProjects[];
    },
  });
}
