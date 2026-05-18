export type ProblemType =
  | "budget_overrun"
  | "underquoting"
  | "extension_pressure"
  | "late_internal"
  | "late_external";

export type Severity = "low" | "med" | "high";

export type ProjectProblemRow = {
  id: string;
  project_id: string;
  problem_type: ProblemType;
  severity: Severity;
  details: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type ProjectEventRow = {
  id: string;
  project_id: string;
  event_type: string;
  clickup_task_id: string | null;
  actor_team_member_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  synced_at: string;
};

export const PROBLEM_LABEL: Record<ProblemType, string> = {
  budget_overrun: "Budget overrun",
  underquoting: "Underquoted",
  extension_pressure: "Extension pressure",
  late_internal: "Late delivery (internal)",
  late_external: "Late delivery (client-blocked)",
};

/**
 * Pure detector for the budget_overrun + underquoting rules. Extracted for
 * unit-testability — the production detector edge fn runs the same logic
 * against project_actuals + projects.
 */
export function detectBudgetProblems(args: {
  actualPoints: number;
  budgetedPoints: number;
  /** 0..1 indicating how far through the project's planned timeline we are. */
  timelineProgress: number;
}): Array<{ type: ProblemType; severity: Severity; details: Record<string, unknown> }> {
  const out: Array<{ type: ProblemType; severity: Severity; details: Record<string, unknown> }> = [];
  if (args.budgetedPoints <= 0) return out;
  const overrunPct = args.actualPoints / args.budgetedPoints - 1;
  if (overrunPct > 0) {
    out.push({
      type: "budget_overrun",
      severity: overrunPct > 0.25 ? "high" : "med",
      details: {
        actual_points: args.actualPoints,
        budgeted_points: args.budgetedPoints,
        overrun_pct: round2(overrunPct),
      },
    });
  }
  if (overrunPct > 0.25 && args.timelineProgress >= 0.8) {
    out.push({
      type: "underquoting",
      severity: "med",
      details: {
        overrun_pct: round2(overrunPct),
        timeline_progress: round2(args.timelineProgress),
      },
    });
  }
  return out;
}

export function detectExtensionPressure(extensionCount: number) {
  if (extensionCount < 2) return null;
  const severity: Severity = extensionCount >= 4 ? "med" : "low";
  return {
    type: "extension_pressure" as const,
    severity,
    details: { extension_count: extensionCount },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
