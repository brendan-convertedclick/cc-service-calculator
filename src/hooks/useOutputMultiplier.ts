import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type MultiplierView = "direct" | "parallel" | "passive";
export type MultiplierPeriod = "year" | "month" | "week";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DirectMember {
  email: string;
  display_name: string;
  human_hours: number;
  ai_session_hours: number;
  ai_cost_zar: number;
  multiplier: number;
  effective_output_hours: number;
}

export interface DirectData {
  periodLabel: string;
  members: DirectMember[];
  totals: {
    avg_multiplier: number;
    total_human_hours: number;
    total_ai_hours: number;
    total_cost_zar: number;
  };
}

export interface ParallelSession {
  slot: number;
  project_slug: string;
  duration_minutes: number;
}

export interface ParallelDay {
  date: string;
  sessions: ParallelSession[];
  concurrent_count: number;
  parallel_multiplier: number;
}

export interface ParallelData {
  periodLabel: string;
  days: ParallelDay[];
  summary: {
    avg_concurrent: number;
    peak_concurrent: number;
    parallel_output_hours: number;
    wall_clock_hours: number;
  };
}

export interface PassiveAgent {
  id: string;
  name: string;
  description: string;
  runs: number;
  estimated_human_hours: number;
  blended_cost_zar: number;
}

export interface PassiveData {
  periodLabel: string;
  agents: PassiveAgent[];
  totals: {
    total_runs: number;
    total_passive_hours: number;
    total_cost_zar: number;
  };
}

export type OutputMultiplierData = DirectData | ParallelData | PassiveData;

// ─── Pure functions (exported for testing) ───────────────────────────────────

export function computeMultiplierFrontend(humanHours: number, aiHours: number): number {
  if (humanHours <= 0) return 1;
  return Math.min((humanHours + aiHours) / humanHours, 20);
}

export interface BubbleRadii {
  innerR: number;
  middleR: number;
  outerR: number;
}

export function computeBubbleRadii(
  humanHours: number,
  aiHours: number,
  multiplier: number,
): BubbleRadii {
  const BASE = 20;
  const MAX = 90;
  const innerR = BASE + Math.sqrt(Math.max(humanHours, 0)) * 8;
  const rawMiddleR = innerR + Math.sqrt(Math.max(aiHours, 0)) * 6;
  const rawOuterR = Math.min(innerR * multiplier, MAX);
  const outerR = Math.max(rawOuterR, rawMiddleR + 2);
  const middleR = rawMiddleR;
  return { innerR, middleR, outerR };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOutputMultiplier(
  view: MultiplierView,
  period: MultiplierPeriod,
  date: string,
  loggedBy?: string,
) {
  return useQuery<OutputMultiplierData>({
    queryKey: ["output-multiplier", view, period, date, loggedBy ?? "team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-output-multiplier", {
        body: { view, period, date, logged_by: loggedBy },
      });
      if (error) throw error;
      return data as OutputMultiplierData;
    },
  });
}
