// src/hooks/useProductivity.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type View = "year" | "month" | "week";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

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

/** Transforms flat sprintPoints rows into recharts-friendly shape:
 *  [{ bucket, [userId]: points, ... }, ...] */
export function buildChartData(
  sprintPoints: SprintPoint[],
  members: Pick<TeamMember, "clickup_user_id" | "full_name">[],
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const sp of sprintPoints) {
    const row = byBucket.get(sp.bucket) ?? { bucket: sp.bucket };
    row[String(sp.userId)] = ((row[String(sp.userId)] as number) ?? 0) + sp.points;
    byBucket.set(sp.bucket, row);
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    String(a.bucket).localeCompare(String(b.bucket)),
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
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
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
