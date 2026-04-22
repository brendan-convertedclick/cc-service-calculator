import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
type TeamInsert = Database["public"]["Tables"]["team_members"]["Insert"];
type TeamUpdate = Database["public"]["Tables"]["team_members"]["Update"];

const KEY = ["team"] as const;

export function useTeam() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .is("archived_at", null)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TeamInsert) => {
      const { data, error } = await supabase.from("team_members").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TeamUpdate }) => {
      const { data, error } = await supabase.from("team_members").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
