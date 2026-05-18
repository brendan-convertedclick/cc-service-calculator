import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROBLEM_LABEL, type ProjectProblemRow } from "@/types/project-problems";

const SEVERITY_ICON = {
  high: AlertCircle,
  med: AlertTriangle,
  low: AlertTriangle,
} as const;
const SEVERITY_VARIANT = {
  high: "destructive",
  med: "warning",
  low: "muted",
} as const;

export function ProblemCard({
  problem,
  onAcknowledge,
}: {
  problem: ProjectProblemRow;
  onAcknowledge?: () => void;
}) {
  const Icon = SEVERITY_ICON[problem.severity];
  return (
    <Card className="shadow-elev-1">
      <CardContent className="flex items-start gap-3 p-4">
        <Icon
          className={
            problem.severity === "high"
              ? "h-5 w-5 shrink-0 text-rose-600"
              : problem.severity === "med"
                ? "h-5 w-5 shrink-0 text-amber-600"
                : "h-5 w-5 shrink-0 text-m-on-surface-variant"
          }
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <div className="text-title-small text-m-on-surface">
              {PROBLEM_LABEL[problem.problem_type]}
            </div>
            <Badge variant={SEVERITY_VARIANT[problem.severity]}>{problem.severity}</Badge>
            {problem.acknowledged_at && (
              <Badge variant="muted" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                ack
              </Badge>
            )}
          </div>
          <p className="text-body-small text-m-on-surface-variant">
            {summariseDetails(problem)}
          </p>
          <p className="text-label-small text-m-on-surface-variant">
            First seen {new Date(problem.first_detected_at).toLocaleString()} · last{" "}
            {new Date(problem.last_detected_at).toLocaleString()}
          </p>
        </div>
        {onAcknowledge && !problem.acknowledged_at && (
          <Button variant="ghost" size="sm" onClick={onAcknowledge}>
            Acknowledge
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function summariseDetails(p: ProjectProblemRow): string {
  switch (p.problem_type) {
    case "budget_overrun": {
      const d = p.details as { actual_points?: number; budgeted_points?: number; overrun_pct?: number };
      return `${d.actual_points}pt actual vs ${d.budgeted_points}pt budgeted (+${Math.round((d.overrun_pct ?? 0) * 100)}%).`;
    }
    case "underquoting": {
      const d = p.details as { overrun_pct?: number; timeline_progress?: number };
      return `Over budget by ${Math.round((d.overrun_pct ?? 0) * 100)}% and ${Math.round((d.timeline_progress ?? 0) * 100)}% through timeline.`;
    }
    case "extension_pressure": {
      const d = p.details as { extension_count?: number };
      return `${d.extension_count} extension requests against this client.`;
    }
    case "late_internal":
      return "A task assigned to staff is past its due date in ClickUp.";
    case "late_external":
      return "A task is in a waiting-on-client status in ClickUp.";
    default:
      return "";
  }
}
