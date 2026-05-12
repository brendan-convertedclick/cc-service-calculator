import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { View } from "@/hooks/useProductivity";
import type { DeliveryData } from "@/types/delivery";

export type { View };

export function useDeliveryMetrics(
  view: View,
  date: string,
  clickupUserId?: number,
) {
  return useQuery<DeliveryData>({
    queryKey: ["deliveryMetrics", view, date, clickupUserId ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-delivery-metrics", {
        body: { view, date, clickup_user_id: clickupUserId },
      });
      if (error) throw error;
      return data as DeliveryData;
    },
  });
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sortBucket(a: string, b: string): number {
  const ai = DAY_ORDER.indexOf(a);
  const bi = DAY_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  return a.localeCompare(b);
}

export function buildRateChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { bucket: b.bucket };
    for (const m of b.members) {
      row[`${m.userId}_ext`] = ((row[`${m.userId}_ext`] as number) ?? 0) + m.externalCompleted;
      row[`${m.userId}_int`] = ((row[`${m.userId}_int`] as number) ?? 0) + m.internalCompleted;
    }
    byBucket.set(b.bucket, row);
  }
  const rows = Array.from(byBucket.values());
  if (view === "week") return DAY_ORDER.map((d) => byBucket.get(d) ?? { bucket: d });
  return rows.sort((a, b) => sortBucket(String(a.bucket), String(b.bucket)));
}

export function buildValueChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): Record<string, number | string>[] {
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { bucket: b.bucket };
    for (const m of b.members) {
      const key = `${m.userId}_value`;
      row[key] = ((row[key] as number) ?? 0) + m.valueZar;
    }
    byBucket.set(b.bucket, row);
  }
  const rows = Array.from(byBucket.values());
  if (view === "week") return DAY_ORDER.map((d) => byBucket.get(d) ?? { bucket: d });
  return rows.sort((a, b) => sortBucket(String(a.bucket), String(b.bucket)));
}

export function buildSpeedChartData(
  buckets: DeliveryData["buckets"],
  view: View,
): { bucket: string; totalCompleted: number; avgCycleDays: number }[] {
  const byBucket = new Map<string, { totalCompleted: number; cycleDaysSum: number; cycleCount: number }>();
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { totalCompleted: 0, cycleDaysSum: 0, cycleCount: 0 };
    for (const m of b.members) {
      row.totalCompleted += m.externalCompleted + m.internalCompleted;
      if (m.avgCycleDays > 0) {
        row.cycleDaysSum += m.avgCycleDays * (m.externalCompleted + m.internalCompleted);
        row.cycleCount += m.externalCompleted + m.internalCompleted;
      }
    }
    byBucket.set(b.bucket, row);
  }
  const allKeys = view === "week" ? DAY_ORDER : Array.from(byBucket.keys()).sort(sortBucket);
  return allKeys.map((bucket) => {
    const r = byBucket.get(bucket);
    return {
      bucket,
      totalCompleted: r?.totalCompleted ?? 0,
      avgCycleDays: r && r.cycleCount > 0 ? Math.round((r.cycleDaysSum / r.cycleCount) * 10) / 10 : 0,
    };
  });
}
