import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DeliveryRate {
  onTime: number;
  total: number;
  rate: number;
}

export function useDeliveryRate(): DeliveryRate | null {
  const { data } = useQuery({
    queryKey: ["deliveryRate"],
    queryFn: async (): Promise<DeliveryRate> => {
      // Current calendar month window
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      const { data, error } = await supabase
        .from("projects")
        .select("id, completed_at, due_date")
        .eq("status", "completed")
        .gte("completed_at", start.toISOString())
        .lt("completed_at", end.toISOString());

      if (error) throw error;

      const rows = data ?? [];
      // Only projects that had a due_date count toward the denominator
      const withDueDate = rows.filter((p) => p.due_date != null);
      const total = withDueDate.length;
      const onTime = withDueDate.filter(
        (p) => p.completed_at != null && p.completed_at <= p.due_date!,
      ).length;
      const rate = total > 0 ? Math.round((onTime / total) * 100) : 0;

      return { onTime, total, rate };
    },
    staleTime: 10 * 60 * 1000,
  });

  return data ?? null;
}
