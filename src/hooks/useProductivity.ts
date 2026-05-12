// src/hooks/useProductivity.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type View = "year" | "month" | "week";

export interface SprintPoint {
  bucket: string;
  userId: number;
  points: number;
}

export interface TimeEntry {
  bucket: string;
  userId: number;
  hours: number;
}

export interface ProductivityMeta {
  periodLabel: string;
  totalPoints: number;
  totalHours: number;
  dailyAvg: number;
  activeContributors: number;
}

export interface ProductivityData {
  sprintPoints: SprintPoint[];
  timeEntries: TimeEntry[];
  meta: ProductivityMeta;
}

export const MEMBER_COLORS = [
  "#7C3AED",
  "#EC4899",
  "#0891B2",
  "#059669",
  "#D97706",
  "#E11D48",
  "#4F46E5",
];

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sortBucket(a: string, b: string): number {
  const ai = DAY_ORDER.indexOf(a);
  const bi = DAY_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  return a.localeCompare(b);
}

/** Transforms flat sprintPoints rows into recharts-friendly shape:
 *  [{ bucket, [userId]: points, ... }, ...] */
export function buildChartData(
  sprintPoints: SprintPoint[],
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const sp of sprintPoints) {
    const row = byBucket.get(sp.bucket) ?? { bucket: sp.bucket };
    row[String(sp.userId)] = ((row[String(sp.userId)] as number) ?? 0) + sp.points;
    byBucket.set(sp.bucket, row);
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    sortBucket(String(a.bucket), String(b.bucket)),
  );
}

/** Transforms flat timeEntries rows into recharts-friendly shape:
 *  [{ bucket, hours }, ...] */
export function buildHoursData(
  timeEntries: TimeEntry[],
): { bucket: string; hours: number }[] {
  const byBucket = new Map<string, number>();
  for (const te of timeEntries) {
    byBucket.set(te.bucket, (byBucket.get(te.bucket) ?? 0) + te.hours);
  }
  return Array.from(byBucket.entries())
    .map(([bucket, hours]) => ({ bucket, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => sortBucket(a.bucket, b.bucket));
}

export function useProductivity(
  view: View,
  date: string,
  clickupUserId?: number,
) {
  return useQuery<ProductivityData>({
    queryKey: ["productivity", view, date, clickupUserId ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-productivity", {
        body: { view, date, clickup_user_id: clickupUserId },
      });
      if (error) throw error;
      return data as ProductivityData;
    },
  });
}
