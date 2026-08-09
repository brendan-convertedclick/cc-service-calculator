import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ProjectProblemRow, ProjectEventRow } from "@/types/project-problems";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function useProjectProblems(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["project-problems", projectId],
    queryFn: async (): Promise<ProjectProblemRow[]> => {
      if (!projectId) throw new Error("projectId required");
      const { data, error } = await supabase
        .from("project_problems")
        .select("*")
        .eq("project_id", projectId)
        .is("resolved_at", null)
        .order("severity", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectProblemRow[];
    },
  });
}

export function useProjectEvents(projectId: string | undefined, limit = 100) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["project-events", projectId, limit],
    queryFn: async (): Promise<ProjectEventRow[]> => {
      if (!projectId) throw new Error("projectId required");
      const { data, error } = await supabase
        .from("project_events")
        .select("*")
        .eq("project_id", projectId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectEventRow[];
    },
  });
}

export function useAllUnresolvedProblems() {
  return useQuery({
    queryKey: ["project-problems", "all-unresolved"],
    queryFn: async (): Promise<ProjectProblemRow[]> => {
      const { data, error } = await supabase
        .from("project_problems")
        .select("*")
        .is("resolved_at", null);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectProblemRow[];
    },
  });
}

export function useAcknowledgeProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, teamMemberId }: { id: string; teamMemberId: string | null }) => {
      const { error } = await supabase
        .from("project_problems")
        .update({
          acknowledged_by: teamMemberId,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-problems"] });
    },
  });
}

export function useRunDetectorForProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/detect-project-problems`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Detector failed");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-problems"] });
    },
  });
}
