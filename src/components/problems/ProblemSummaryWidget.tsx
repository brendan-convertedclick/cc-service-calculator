import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllUnresolvedProblems } from "@/hooks/useProjectProblems";
import { PROBLEM_LABEL, type ProblemType } from "@/types/project-problems";

/**
 * Compact at-a-glance widget for Dashboard / Pulse. Counts unresolved
 * problems by severity and type.
 */
export function ProblemSummaryWidget() {
  const { data: problems = [], isLoading } = useAllUnresolvedProblems();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-title-small">Problems</CardTitle>
        </CardHeader>
        <CardContent className="text-body-small text-m-on-surface-variant">
          Loading…
        </CardContent>
      </Card>
    );
  }

  const highCount = problems.filter((p) => p.severity === "high").length;
  const medCount = problems.filter((p) => p.severity === "med").length;
  const byType = new Map<ProblemType, number>();
  for (const p of problems) byType.set(p.problem_type, (byType.get(p.problem_type) ?? 0) + 1);

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-title-small">
          <span>Problems</span>
          <span className="flex items-center gap-3 text-label-small text-m-on-surface-variant">
            <span className="flex items-center gap-1 text-rose-600">
              <AlertCircle className="h-3 w-3" />
              {highCount}
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {medCount}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-body-small">
        {problems.length === 0 ? (
          <p className="text-m-on-surface-variant">All clear. ✨</p>
        ) : (
          Array.from(byType.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <div
                key={type}
                className="flex items-center justify-between text-m-on-surface"
              >
                <span>{PROBLEM_LABEL[type]}</span>
                <span className="text-label-small text-m-on-surface-variant">{count}</span>
              </div>
            ))
        )}
        <div className="pt-2 text-label-small">
          <Link to="/pulse" className="text-m-primary hover:underline">
            See in Pulse →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
