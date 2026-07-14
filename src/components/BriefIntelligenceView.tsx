// src/components/BriefIntelligenceView.tsx
import { useEffect, useState } from "react";
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
import type { Database } from "@/types/db";
import type {
  Requirement,
  DeptBreakdown,
  OpenQuestion,
} from "@/types/brief-intelligence";
import {
  recomputeTotals,
  computeEstimatedPriceCents,
} from "@/lib/brief-estimate";

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
  workBreakdown: DeptBreakdown[];
  openQuestions: OpenQuestion[];
  priceCents: number;
  priceTouched: boolean;
};

interface Props {
  intelligence: BriefIntelligence | null;
  isLoading: boolean;
  departments?: { id: string; hourly_rate_cents: number }[];
  onSave?: (patch: BriefIntelligenceUpdate) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}

function HoursField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label-small text-m-on-surface-variant">{label}</span>
      <Input
        type="number"
        step="0.5"
        min="0"
        value={String(value ?? 0)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(Number.isFinite(v) ? v : 0);
        }}
      />
    </label>
  );
}

export function BriefIntelligenceView({
  intelligence,
  isLoading,
  departments,
  onSave,
  onEditingChange,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

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

  const rateByDeptId = new Map<string, number>(
    (departments ?? []).map((d) => [d.id, d.hourly_rate_cents]),
  );

  const requirements = (intelligence.requirements as Requirement[] | null) ?? [];
  const workBreakdown = (intelligence.work_breakdown as DeptBreakdown[] | null) ?? [];
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
      workBreakdown: structuredClone(workBreakdown),
      openQuestions: structuredClone(openQuestions),
      priceCents: intelligence.estimated_price_cents ?? 0,
      priceTouched: false,
    });

  const cancelEdit = () => setDraft(null);

  const update = (patch: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const updateDept = (i: number, patch: Partial<DeptBreakdown>) =>
    update({
      workBreakdown: (draft?.workBreakdown ?? []).map((d, j) =>
        j === i ? { ...d, ...patch } : d,
      ),
    });

  const handleSave = async () => {
    if (!draft || !onSave) return;
    setSaving(true);
    try {
      const totals = recomputeTotals(draft.workBreakdown);
      const computed = computeEstimatedPriceCents(draft.workBreakdown, rateByDeptId);
      const priceCents = draft.priceTouched ? draft.priceCents : computed;
      await onSave({
        summary: draft.summary,
        business_objective: draft.business_objective,
        confidence_level: draft.confidence_level,
        requirements: draft.requirements as unknown as BriefIntelligenceUpdate["requirements"],
        work_breakdown: draft.workBreakdown as unknown as BriefIntelligenceUpdate["work_breakdown"],
        open_questions: draft.openQuestions as unknown as BriefIntelligenceUpdate["open_questions"],
        estimated_price_cents: priceCents,
        ...totals,
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

        {/* Work Breakdown */}
        {workBreakdown.length > 0 && (
          <div className="rounded-lg border p-4 space-y-4">
            <span className="text-title-small font-medium text-m-on-surface">
              Work Breakdown
            </span>
            {workBreakdown.map((dept, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-title-small font-medium">
                    {dept.department_name}
                  </span>
                  <span className="text-body-small text-m-on-surface-variant">
                    <span className="font-mono tabular-nums">{dept.human_hours_low}–{dept.human_hours_high}</span> hrs human
                    {dept.ai_hours > 0 && (
                      <span className="ml-2 text-m-primary">· <span className="font-mono tabular-nums">{dept.ai_hours}</span> hrs AI</span>
                    )}
                  </span>
                </div>
                {dept.deliverables?.length > 0 && (
                  <ul className="ml-3 space-y-1">
                    {dept.deliverables.map((d, j) => (
                      <li key={j} className="text-body-small text-m-on-surface-variant">
                        <CornerDownRight className="mr-1 inline h-3 w-3 text-m-outline" aria-hidden />
                        {d.name}
                        {d.format && <span className="ml-1 text-m-outline">({d.format})</span>}
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
                  <span className="font-mono tabular-nums">
                    {intelligence.total_human_hours_low ?? "?"}–
                    {intelligence.total_human_hours_high ?? "?"}
                  </span>{" "}
                  hrs
                </div>
                {(intelligence.total_ai_hours ?? 0) > 0 && (
                  <div className="text-body-small text-m-primary">
                    + <span className="font-mono tabular-nums">{intelligence.total_ai_hours}</span> hrs AI
                  </div>
                )}
              </div>
            )}
            {intelligence.estimated_price_cents != null && (
              <div>
                <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
                <div className="text-title-medium font-mono tabular-nums">{zar(intelligence.estimated_price_cents)}</div>
              </div>
            )}
          </div>
        )}

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
  const totals = recomputeTotals(draft.workBreakdown);
  const computedPrice = computeEstimatedPriceCents(draft.workBreakdown, rateByDeptId);
  const displayPrice = draft.priceTouched ? draft.priceCents : computedPrice;

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
            <SelectTrigger className="h-8 w-40 shrink-0 text-label-small" aria-label="Confidence level">
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
          <div key={i} className="space-y-1 rounded border p-2">
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

      {/* Work Breakdown */}
      <div className="rounded-lg border p-4 space-y-4">
        <span className="text-title-small font-medium text-m-on-surface">
          Work Breakdown
        </span>
        {draft.workBreakdown.map((dept, i) => (
          <div key={i} className="space-y-3 rounded border p-3">
            <span className="text-title-small font-medium">{dept.department_name}</span>
            <div className="grid grid-cols-4 gap-2">
              <HoursField label="Low" value={dept.human_hours_low} onChange={(v) => updateDept(i, { human_hours_low: v })} />
              <HoursField label="Mid" value={dept.human_hours_mid} onChange={(v) => updateDept(i, { human_hours_mid: v })} />
              <HoursField label="High" value={dept.human_hours_high} onChange={(v) => updateDept(i, { human_hours_high: v })} />
              <HoursField label="AI" value={dept.ai_hours} onChange={(v) => updateDept(i, { ai_hours: v })} />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-label-small text-m-on-surface-variant">Deliverables</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateDept(i, { deliverables: [...(dept.deliverables ?? []), { name: "" }] })
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(dept.deliverables ?? []).map((d, j) => (
                <div key={j} className="flex gap-2">
                  <Input
                    value={d.name}
                    placeholder="Deliverable"
                    onChange={(e) =>
                      updateDept(i, {
                        deliverables: dept.deliverables.map((x, k) =>
                          k === j ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      updateDept(i, { deliverables: dept.deliverables.filter((_, k) => k !== j) })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-label-small text-m-on-surface-variant">Tasks</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateDept(i, { tasks: [...(dept.tasks ?? []), { title: "" }] })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(dept.tasks ?? []).map((t, j) => (
                <div key={j} className="flex gap-2">
                  <Input
                    value={t.title}
                    placeholder="Task title"
                    onChange={(e) =>
                      updateDept(i, {
                        tasks: dept.tasks.map((x, k) =>
                          k === j ? { ...x, title: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Input
                    value={t.description ?? ""}
                    placeholder="Description"
                    onChange={(e) =>
                      updateDept(i, {
                        tasks: dept.tasks.map((x, k) =>
                          k === j ? { ...x, description: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      updateDept(i, { tasks: dept.tasks.filter((_, k) => k !== j) })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Estimate */}
      <div className="rounded-lg border bg-m-surface-container-high p-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-label-small text-m-on-surface-variant">Human hours</div>
          <div className="text-title-medium">
            <span className="font-mono tabular-nums">{totals.total_human_hours_low}–{totals.total_human_hours_high}</span> hrs
          </div>
          {totals.total_ai_hours > 0 && (
            <div className="text-body-small text-m-primary">+ <span className="font-mono tabular-nums">{totals.total_ai_hours}</span> hrs AI</div>
          )}
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
              value={(displayPrice / 100).toString()}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                update({
                  priceCents: Number.isFinite(v) ? Math.round(v * 100) : 0,
                  priceTouched: true,
                });
              }}
            />
          </div>
          {draft.priceTouched ? (
            <button
              type="button"
              className="text-label-small text-m-primary underline"
              onClick={() => update({ priceTouched: false })}
            >
              reset to computed (<span className="font-mono tabular-nums">{zar(computedPrice)}</span>)
            </button>
          ) : (
            <div className="text-label-small text-m-on-surface-variant">
              computed from hours × rate
            </div>
          )}
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
