import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useMonthlyHoursBurned(): number | null {
  const { data } = useQuery({
    queryKey: ["monthlyHoursBurned"],
    queryFn: async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("project_actuals_current")
        .select("actual_hours, recorded_at")
        .gte("recorded_at", start.toISOString());

      if (error) throw error;
      const total = (data ?? []).reduce((sum, row) => sum + (row.actual_hours ?? 0), 0);
      return Math.round(total * 10) / 10; // 1 decimal place
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? null;
}
