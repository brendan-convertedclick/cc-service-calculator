// src/components/BriefIntelligenceView.tsx
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/types/db";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];

type Requirement = {
  text: string;
  interpretation: string;
  mapped_service_ids: string[];
  confidence: "low" | "med" | "high";
};

type DeptBreakdown = {
  department_id: string;
  department_name: string;
  deliverables: { name: string; format?: string; quantity?: number; platform?: string }[];
  tasks: { title: string; description?: string; is_ai_eligible?: boolean }[];
  human_hours_low: number;
  human_hours_mid: number;
  human_hours_high: number;
  ai_hours: number;
};

type OpenQuestion = { question: string; context: string };

const CONFIDENCE_COLOURS: Record<string, string> = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
};

interface Props {
  intelligence: BriefIntelligence | null;
  isLoading: boolean;
}

export function BriefIntelligenceView({ intelligence, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (!intelligence) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-body-medium text-m-on-surface-variant">
        Analysing brief… This usually takes under 30 seconds.
      </div>
    );
  }

  const requirements = (intelligence.requirements as Requirement[] | null) ?? [];
  const workBreakdown = (intelligence.work_breakdown as DeptBreakdown[] | null) ?? [];
  const openQuestions = (intelligence.open_questions as OpenQuestion[] | null) ?? [];

  const confidenceClass =
    CONFIDENCE_COLOURS[intelligence.confidence_level ?? "low"] ??
    CONFIDENCE_COLOURS.low;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {(intelligence.summary || intelligence.business_objective) && (
        <div className="rounded-lg border bg-m-surface-container p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
              Brief Summary
            </span>
            {intelligence.confidence_level && (
              <Badge
                variant="outline"
                className={`text-label-small ${confidenceClass}`}
              >
                {intelligence.confidence_level} confidence
              </Badge>
            )}
          </div>
          {intelligence.summary && (
            <p className="text-body-medium">{intelligence.summary}</p>
          )}
          {intelligence.business_objective && (
            <p className="text-body-small text-m-on-surface-variant">
              <span className="font-medium">Objective:</span>{" "}
              {intelligence.business_objective}
            </p>
          )}
        </div>
      )}

      {/* Requirements */}
      {requirements.length > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
            Requirements
          </span>
          <ul className="space-y-3">
            {requirements.map((req, i) => (
              <li key={i} className="space-y-1">
                <p className="text-body-medium">
                  <span className="text-m-on-surface-variant mr-1">●</span>
                  &ldquo;{req.text}&rdquo;
                </p>
                {req.interpretation && (
                  <p className="ml-4 text-body-small text-m-on-surface-variant">
                    {req.interpretation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Work Breakdown */}
      {workBreakdown.length > 0 && (
        <div className="rounded-lg border p-4 space-y-4">
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
            Work Breakdown
          </span>
          {workBreakdown.map((dept, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-title-small font-medium">
                  {dept.department_name}
                </span>
                <span className="text-body-small text-m-on-surface-variant">
                  {dept.human_hours_low}–{dept.human_hours_high} hrs human
                  {dept.ai_hours > 0 && (
                    <span className="ml-2 text-m-primary">
                      · {dept.ai_hours} hrs AI
                    </span>
                  )}
                </span>
              </div>
              {dept.deliverables?.length > 0 && (
                <ul className="ml-3 space-y-1">
                  {dept.deliverables.map((d, j) => (
                    <li key={j} className="text-body-small text-m-on-surface-variant">
                      ∟ {d.name}
                      {d.format && (
                        <span className="ml-1 text-m-outline">({d.format})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Estimate */}
      {(intelligence.total_human_hours_mid != null ||
        intelligence.estimated_price_cents != null) && (
        <div className="rounded-lg border bg-m-surface-container-high p-4 grid grid-cols-2 gap-4">
          {intelligence.total_human_hours_mid != null && (
            <div>
              <div className="text-label-small text-m-on-surface-variant">Human hours</div>
              <div className="text-title-medium">
                {intelligence.total_human_hours_low}–
                {intelligence.total_human_hours_high} hrs
              </div>
              {(intelligence.total_ai_hours ?? 0) > 0 && (
                <div className="text-body-small text-m-primary">
                  + {intelligence.total_ai_hours} hrs AI
                </div>
              )}
            </div>
          )}
          {intelligence.estimated_price_cents != null && (
            <div>
              <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
              <div className="text-title-medium">
                {new Intl.NumberFormat("en-ZA", {
                  style: "currency",
                  currency: "ZAR",
                }).format(intelligence.estimated_price_cents / 100)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Open Questions */}
      {openQuestions.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-2">
          <span className="text-label-small font-medium text-yellow-800 uppercase tracking-wide">
            Open Questions
          </span>
          <ul className="space-y-1">
            {openQuestions.map((q, i) => (
              <li key={i} className="text-body-small text-yellow-900">
                ⚠ {q.question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
