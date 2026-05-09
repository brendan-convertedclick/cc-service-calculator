import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DftCycleTime {
  avgDays: number | null;
  sampleSize: number;
}

export function useAvgDftCycleTime(): DftCycleTime | null {
  const { data } = useQuery({
    queryKey: ["avgDftCycleTime"],
    queryFn: async (): Promise<DftCycleTime> => {
      // Rolling 30-day window for first_delivery_at
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);

      // Fetch projects with first_delivery_at in the rolling 30 days
      const { data: projects, error: pErr } = await supabase
        .from("projects")
        .select("id, first_delivery_at")
        .not("first_delivery_at", "is", null)
        .gte("first_delivery_at", cutoff.toISOString());

      if (pErr) throw pErr;
      if (!projects || projects.length === 0) return { avgDays: null, sampleSize: 0 };

      const projectIds = projects.map((p) => p.id);

      // Fetch the earliest brief created_at for each project
      const { data: briefs, error: bErr } = await supabase
        .from("briefs")
        .select("parent_project_id, created_at")
        .in("parent_project_id", projectIds);

      if (bErr) throw bErr;

      // Build map: project_id → earliest brief created_at
      const earliestBrief = new Map<string, string>();
      for (const b of briefs ?? []) {
        if (!b.parent_project_id) continue;
        const existing = earliestBrief.get(b.parent_project_id);
        if (!existing || b.created_at < existing) {
          earliestBrief.set(b.parent_project_id, b.created_at);
        }
      }

      const cycleTimes: number[] = [];
      for (const p of projects) {
        const briefAt = earliestBrief.get(p.id);
        if (!briefAt || !p.first_delivery_at) continue;
        const diffMs =
          new Date(p.first_delivery_at).getTime() - new Date(briefAt).getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays >= 0) cycleTimes.push(diffDays);
      }

      if (cycleTimes.length === 0) return { avgDays: null, sampleSize: 0 };

      const avgDays =
        Math.round(
          (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) * 10,
        ) / 10;

      return { avgDays, sampleSize: cycleTimes.length };
    },
    staleTime: 10 * 60 * 1000,
  });

  return data ?? null;
}
