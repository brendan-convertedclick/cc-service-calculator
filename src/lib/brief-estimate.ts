// src/lib/brief-estimate.ts
import type { DeptBreakdown } from "@/types/brief-intelligence";

export type HourTotals = {
  total_human_hours_low: number;
  total_human_hours_mid: number;
  total_human_hours_high: number;
  total_ai_hours: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function recomputeTotals(breakdown: DeptBreakdown[]): HourTotals {
  return breakdown.reduce<HourTotals>(
    (acc, d) => ({
      total_human_hours_low:  round2(acc.total_human_hours_low  + (d.human_hours_low  || 0)),
      total_human_hours_mid:  round2(acc.total_human_hours_mid  + (d.human_hours_mid  || 0)),
      total_human_hours_high: round2(acc.total_human_hours_high + (d.human_hours_high || 0)),
      total_ai_hours:         round2(acc.total_ai_hours         + (d.ai_hours         || 0)),
    }),
    {
      total_human_hours_low: 0,
      total_human_hours_mid: 0,
      total_human_hours_high: 0,
      total_ai_hours: 0,
    },
  );
}

export function computeEstimatedPriceCents(
  breakdown: DeptBreakdown[],
  rateByDeptId: Map<string, number>,
): number {
  return breakdown.reduce((acc, d) => {
    const rate = rateByDeptId.get(d.department_id) ?? 0;
    return acc + Math.round((d.human_hours_high || 0) * rate);
  }, 0);
}
