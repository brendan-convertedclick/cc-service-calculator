// src/hooks/useProductivity.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type View = "year" | "month" | "week";

export interface SprintPoint {
  bucket: string;
  userId: number;
  points: number;
  selfCreatedPoints: number;
  businessCreatedPoints: number;
}

export interface PointModification {
  bucket: string;
  taskId: string;
  taskName: string;
  userId: number;
  oldPoints: number;
  newPoints: number;
  changedAt: string; // unix ms as string
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
  totalOverheadHours: number;
  dailyAvg: number;
  activeContributors: number;
}

export interface ProductivityData {
  sprintPoints: SprintPoint[];
  timeEntries: TimeEntry[];
  overheadEntries: TimeEntry[];
  meta: ProductivityMeta;
  pointModifications: PointModification[];
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
 *  [{ bucket, [userId]_business: businessCreatedPoints, [userId]_self: selfCreatedPoints, ... }, ...] */
export function buildChartData(
  sprintPoints: SprintPoint[],
  view?: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const sp of sprintPoints) {
    const row = byBucket.get(sp.bucket) ?? { bucket: sp.bucket };
    const businessKey = `${sp.userId}_business`;
    const selfKey = `${sp.userId}_self`;
    row[businessKey] = ((row[businessKey] as number) ?? 0) + sp.businessCreatedPoints;
    row[selfKey] = ((row[selfKey] as number) ?? 0) + sp.selfCreatedPoints;
    row[`${sp.userId}_total`] = (row[businessKey] as number) + (row[selfKey] as number);
    byBucket.set(sp.bucket, row);
  }
  if (view === "week") {
    return DAY_ORDER.map((day) => byBucket.get(day) ?? { bucket: day });
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    sortBucket(String(a.bucket), String(b.bucket)),
  );
}

/** Transforms flat timeEntries rows into recharts-friendly shape:
 *  [{ bucket, [userId]_hours: hours, ... }, ...] */
export function buildHoursData(
  timeEntries: TimeEntry[],
  view?: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const te of timeEntries) {
    const row = byBucket.get(te.bucket) ?? { bucket: te.bucket };
    const key = `${te.userId}_hours`;
    row[key] = Math.round(((row[key] as number ?? 0) + te.hours) * 10) / 10;
    byBucket.set(te.bucket, row);
  }
  if (view === "week") {
    return DAY_ORDER.map((day) => byBucket.get(day) ?? { bucket: day });
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    sortBucket(String(a.bucket), String(b.bucket)),
  );
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
