// src/components/BriefIntelligenceView.tsx
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CornerDownRight, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments } from "@/hooks/useDepartments";
import { useLineTasks } from "@/hooks/usePlacementTasks";
import { useScopeMapPlacements } from "@/hooks/useScopeMap";
import { isBillablePlacement } from "@/types/sow-placements";
import type { Database } from "@/types/db";
import type { Requirement, OpenQuestion } from "@/types/brief-intelligence";

type BriefIntelligence =
  Database["public"]["Tables"]["brief_intelligence"]["Row"];
type BriefIntelligenceUpdate =
  Database["public"]["Tables"]["brief_intelligence"]["Update"];

// Confidence uses the house Badge semantic language (emerald / amber / neutral),
// the same vocabulary as the Scope Receipt's ConfidenceChip — one colour system
// for "confidence" across the page rather than a second green/yellow/red set.
const CONFIDENCE_VARIANT: Record<string, "success" | "warning" | "muted"> = {
  high: "success",
  medium: "warning",
  low: "muted",
};

const zar = (cents: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100,
  );

type Draft = {
  summary: string;
  business_objective: string;
  confidence_level: string;
  requirements: Requirement[];
  openQuestions: OpenQuestion[];
  priceCents: number;
};

interface Props {
  /** Brief id — the work breakdown mirrors this brief's Stage-1 team tasks. */
  briefId: string;
  intelligence: BriefIntelligence | null;
  isLoading: boolean;
  onSave?: (patch: BriefIntelligenceUpdate) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}

type BreakdownLine = {
  placementId: string;
  name: string;
  tasks: Array<{ id: string; title: string; deptName: string; hours: number; points: number }>;
  hours: number;
  points: number;
};

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Read-only mirror of Stage 1's billable lines and their team task breakdown
 * (placement_tasks). Every billable line shows here — with its team tasks
 * beneath, or a hint when none exist yet. Out-of-scope lines are excluded on
 * purpose: they aren't offered, so they carry no work. This is the single
 * source of truth for time — it is edited on the scope receipt in step 1,
 * never here.
 */
function TeamBreakdownCard({ lines }: { lines: BreakdownLine[] }) {
  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-title-small font-medium text-m-on-surface">
          Work Breakdown
        </span>
        <span className="text-label-small text-m-on-surface-variant">
          From the billable lines in step 1 — edit there
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-body-small text-m-on-surface-variant">
          No billable lines yet — add them on the scope receipt in step 1.
        </p>
      ) : (
        lines.map((l) => (
          <div key={l.placementId} className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 break-words text-title-small font-medium">{l.name}</span>
              {l.tasks.length > 0 && (
                <span className="shrink-0 text-body-small text-m-on-surface-variant">
                  <span className="font-mono tabular-nums">{fmtNum(l.hours)}</span>h ·{" "}
                  <span className="font-mono tabular-nums">{fmtNum(l.points)}</span>pt
                </span>
              )}
            </div>
            {l.tasks.length === 0 ? (
              <p className="ml-3 text-body-small text-m-outline">
                <CornerDownRight className="mr-1 inline h-3 w-3" aria-hidden />
                No team tasks yet — add them on this line in step 1.
              </p>
            ) : (
              <ul className="ml-3 space-y-1">
                {l.tasks.map((t) => (
                  <li key={t.id} className="text-body-small text-m-on-surface-variant">
                    <CornerDownRight className="mr-1 inline h-3 w-3 text-m-outline" aria-hidden />
                    {t.title}
                    <span className="ml-1 text-m-outline">
                      ({t.deptName} · <span className="font-mono tabular-nums">{fmtNum(t.hours)}</span>h)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function BriefIntelligenceView({
  briefId,
  intelligence,
  isLoading,
  onSave,
  onEditingChange,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Stage-1 team task breakdown — the source of truth for time.
  const { data: placements } = useScopeMapPlacements(briefId);
  const { data: lineTasks } = useLineTasks(briefId);
  const { data: allDepts } = useDepartments();

  const breakdownLines = useMemo<BreakdownLine[]>(() => {
    const deptName = new Map((allDepts ?? []).map((d) => [d.id, d.name]));
    const tasksByPlacement = new Map<string, BreakdownLine["tasks"]>();
    for (const t of lineTasks ?? []) {
      if (t.title.trim() === "") continue;
      const arr = tasksByPlacement.get(t.placement_id) ?? [];
      arr.push({
        id: t.id,
        title: t.title,
        deptName: (t.department_id && deptName.get(t.department_id)) || "Unassigned",
        hours: t.hours,
        points: t.points,
      });
      tasksByPlacement.set(t.placement_id, arr);
    }
    return (placements ?? []).filter(isBillablePlacement).map((p) => {
      const tasks = tasksByPlacement.get(p.id) ?? [];
      return {
        placementId: p.id,
        name: p.item_name ?? p.task_ref,
        tasks,
        hours: tasks.reduce((s, t) => s + t.hours, 0),
        points: tasks.reduce((s, t) => s + t.points, 0),
      };
    });
  }, [placements, lineTasks, allDepts]);

  const teamTotals = useMemo(
    () => ({
      hours: breakdownLines.reduce((s, l) => s + l.hours, 0),
      points: breakdownLines.reduce((s, l) => s + l.points, 0),
    }),
    [breakdownLines],
  );

  useEffect(() => {
    onEditingChange?.(draft !== null);
  }, [draft, onEditingChange]);

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
    return null;
  }

  const requirements = (intelligence.requirements as Requirement[] | null) ?? [];
  const openQuestions = (intelligence.open_questions as OpenQuestion[] | null) ?? [];

  const confidenceVariant =
    CONFIDENCE_VARIANT[intelligence.confidence_level ?? "low"] ?? "muted";

  const canEdit = !!onSave;

  const startEdit = () =>
    setDraft({
      summary: intelligence.summary ?? "",
      business_objective: intelligence.business_objective ?? "",
      confidence_level: intelligence.confidence_level ?? "low",
      requirements: structuredClone(requirements),
      openQuestions: structuredClone(openQuestions),
      priceCents: intelligence.estimated_price_cents ?? 0,
    });

  const cancelEdit = () => setDraft(null);

  const update = (patch: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const handleSave = async () => {
    if (!draft || !onSave) return;
    setSaving(true);
    try {
      // Time lives in the Stage-1 team task breakdown — never written here.
      await onSave({
        summary: draft.summary,
        business_objective: draft.business_objective,
        confidence_level: draft.confidence_level,
        requirements: draft.requirements as unknown as BriefIntelligenceUpdate["requirements"],
        open_questions: draft.openQuestions as unknown as BriefIntelligenceUpdate["open_questions"],
        estimated_price_cents: draft.priceCents,
      });
      setDraft(null);
    } catch {
      // keep the draft open so the AM can retry; Scope surfaces the toast
    } finally {
      setSaving(false);
    }
  };

  // ---------- READ-ONLY ----------
  if (!draft) {
    return (
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={startEdit}>
              Edit
            </Button>
          </div>
        )}

        {/* Summary */}
        {(intelligence.summary || intelligence.business_objective) && (
          <div className="rounded-lg border bg-m-surface-container p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-title-small font-medium text-m-on-surface">
                Brief Summary
              </span>
              {intelligence.confidence_level && (
                <Badge variant={confidenceVariant} className="text-label-small">
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
            <span className="text-title-small font-medium text-m-on-surface">
              Requirements
            </span>
            <ul className="list-disc space-y-3 pl-5 marker:text-m-outline">
              {requirements.map((req, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-body-medium">&ldquo;{req.text}&rdquo;</p>
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

        {/* Work Breakdown — mirror of the Stage-1 team task breakdown */}
        <TeamBreakdownCard lines={breakdownLines} />

        {/* Estimate */}
        <div className="rounded-lg border bg-m-surface-container-high p-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-label-small text-m-on-surface-variant">Team time (step 1)</div>
            <div className="text-title-medium">
              <span className="font-mono tabular-nums">{fmtNum(teamTotals.hours)}</span> hrs ·{" "}
              <span className="font-mono tabular-nums">{fmtNum(teamTotals.points)}</span> pts
            </div>
          </div>
          {intelligence.estimated_price_cents != null && (
            <div>
              <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
              <div className="text-title-medium font-mono tabular-nums">{zar(intelligence.estimated_price_cents)}</div>
            </div>
          )}
        </div>

        {/* Open Questions */}
        {openQuestions.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
            <span className="text-title-small font-medium text-amber-800">
              Open Questions
            </span>
            <ul className="space-y-1">
              {openQuestions.map((q, i) => (
                <li key={i} className="flex items-start gap-1.5 text-body-small text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  {q.question}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ---------- EDIT ----------
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Summary */}
      <div className="rounded-lg border bg-m-surface-container p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-title-small font-medium text-m-on-surface">
            Brief Summary
          </span>
          <Select
            value={draft.confidence_level}
            onValueChange={(v) => update({ confidence_level: v })}
          >
            <SelectTrigger className="h-10 w-40 shrink-0 text-label-small" aria-label="Confidence level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">low confidence</SelectItem>
              <SelectItem value="medium">medium confidence</SelectItem>
              <SelectItem value="high">high confidence</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea
          rows={3}
          placeholder="Summary"
          value={draft.summary}
          onChange={(e) => update({ summary: e.target.value })}
        />
        <Textarea
          rows={2}
          placeholder="Business objective"
          value={draft.business_objective}
          onChange={(e) => update({ business_objective: e.target.value })}
        />
      </div>

      {/* Requirements */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-title-small font-medium text-m-on-surface">
            Requirements
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update({
                requirements: [
                  ...draft.requirements,
                  { text: "", interpretation: "", mapped_service_ids: [], confidence: "low" },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {draft.requirements.map((req, i) => (
          <div key={i} className="space-y-1 rounded-lg border p-2">
            <div className="flex gap-2">
              <Input
                value={req.text}
                placeholder="Requirement"
                onChange={(e) =>
                  update({
                    requirements: draft.requirements.map((r, j) =>
                      j === i ? { ...r, text: e.target.value } : r,
                    ),
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  update({ requirements: draft.requirements.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              value={req.interpretation}
              placeholder="Interpretation"
              onChange={(e) =>
                update({
                  requirements: draft.requirements.map((r, j) =>
                    j === i ? { ...r, interpretation: e.target.value } : r,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>

      {/* Work Breakdown — read-only mirror of step 1, even while editing */}
      <TeamBreakdownCard lines={breakdownLines} />

      {/* Estimate */}
      <div className="rounded-lg border bg-m-surface-container-high p-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-label-small text-m-on-surface-variant">Team time (step 1)</div>
          <div className="text-title-medium">
            <span className="font-mono tabular-nums">{fmtNum(teamTotals.hours)}</span> hrs ·{" "}
            <span className="font-mono tabular-nums">{fmtNum(teamTotals.points)}</span> pts
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
          <div className="flex items-center gap-1">
            <span className="text-title-medium font-mono">R</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="max-w-[10rem]"
              value={(draft.priceCents / 100).toString()}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                update({ priceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
              }}
            />
          </div>
        </div>
      </div>

      {/* Open Questions */}
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-title-small font-medium text-amber-800">
            Open Questions
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update({ openQuestions: [...draft.openQuestions, { question: "", context: "" }] })
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {draft.openQuestions.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={q.question}
              placeholder="Question"
              onChange={(e) =>
                update({
                  openQuestions: draft.openQuestions.map((x, j) =>
                    j === i ? { ...x, question: e.target.value } : x,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                update({ openQuestions: draft.openQuestions.filter((_, j) => j !== i) })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
