import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type Quote = Database["public"]["Tables"]["quotes"]["Row"];

export type ActivityEvent =
  | { type: "brief"; timestamp: string; id: string; brief: Brief }
  | { type: "actuals_update"; timestamp: string; id: string; departmentName: string; totalHours: number }
  | { type: "quote"; timestamp: string; id: string; quote: Quote };

export function useProjectActivity(
  projectId: string | undefined,
  quoteId: string | undefined
) {
  return useQuery({
    queryKey: ["projectActivity", projectId, quoteId],
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!projectId) return [];

      const [briefsRes, actualsRes, quotesRes] = await Promise.all([
        supabase
          .from("briefs")
          .select("*")
          .eq("parent_project_id", projectId),
        supabase
          .from("project_actuals_current")
          .select("*")
          .eq("project_id", projectId),
        quoteId
          ? supabase.from("quotes").select("*").eq("id", quoteId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (briefsRes.error) throw briefsRes.error;
      if (actualsRes.error) throw actualsRes.error;
      if (quotesRes.error) throw quotesRes.error;

      const events: ActivityEvent[] = [
        ...(briefsRes.data ?? []).map((b): ActivityEvent => ({
          type: "brief",
          timestamp: b.created_at,
          id: b.id,
          brief: b,
        })),
        ...(actualsRes.data ?? []).map((a): ActivityEvent => ({
          type: "actuals_update",
          timestamp: a.recorded_at ?? new Date(0).toISOString(),
          id: `${a.project_id}-${a.dept_id}`,
          departmentName: a.dept_id ?? "Unknown",
          totalHours: a.actual_hours ?? 0,
        })),
        ...(quotesRes.data ?? []).map((q): ActivityEvent => ({
          type: "quote",
          timestamp: q.sent_at ?? q.created_at,
          id: q.id,
          quote: q,
        })),
      ];

      return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },
  });
}
