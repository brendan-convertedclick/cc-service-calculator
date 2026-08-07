import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

// The per-person palette. Lives here rather than in useProductivity (which
// re-exports it for its existing consumers) because useTeam is in the main
// bundle and useProductivity is not — importing the other way round would
// drag the productivity module into every page that shows a person.
export const MEMBER_COLORS = [
  "#7C3AED",
  "#EC4899",
  "#0891B2",
  "#059669",
  "#D97706",
  "#E11D48",
  "#4F46E5",
];

// One stable colour per person, from the same palette the productivity Team
// rail already uses — so a face keeps its colour across the app instead of
// every surface inventing its own. Keyed on position in the name-ordered team
// list, which is exactly TeamSidebar's rule.
export function memberColors(team: { id: string }[]): Map<string, string> {
  return new Map(team.map((t, i) => [t.id, MEMBER_COLORS[i % MEMBER_COLORS.length]]));
}
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
