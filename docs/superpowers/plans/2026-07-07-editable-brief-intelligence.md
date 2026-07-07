# Editable Brief Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AM edit brief intelligence (summary, requirements, work breakdown, hours, price, open questions) directly on the Scope review screen via an edit-mode toggle, with a live hours×rate price the AM can override.

**Architecture:** Extract the JSONB shapes into a shared types module; add pure recompute helpers; add an update mutation + poll-pause to the data hook; give `BriefIntelligenceView` an internal edit mode with a local draft; wire departments + mutation + poll-pause + action-bar hiding into `Scope.tsx`.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Supabase JS + TanStack Query + vitest.

## Global Constraints

- Money stored as integer cents; format with `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`.
- Never edit generated token files; use existing `m-`/shadcn Tailwind classes.
- Editing is a direct human override — it does NOT change `am_status` and does NOT re-run the intake pipeline.
- Price basis for the computed default: `Σ(dept.human_hours_high × dept.hourly_rate_cents)`, always shown, AM-overridable.
- Follow existing file conventions in `src/hooks`, `src/lib`, `src/components`.

---

### Task 1: Shared brief-intelligence types

**Files:**
- Create: `src/types/brief-intelligence.ts`

**Interfaces:**
- Produces: `Requirement`, `Deliverable`, `BreakdownTask`, `DeptBreakdown`, `OpenQuestion`.

- [ ] **Step 1: Create the module**

```ts
// src/types/brief-intelligence.ts
export type Requirement = {
  text: string;
  interpretation: string;
  mapped_service_ids: string[];
  confidence: "low" | "medium" | "high";
};

export type Deliverable = {
  name: string;
  format?: string;
  quantity?: number;
  platform?: string;
};

export type BreakdownTask = {
  title: string;
  description?: string;
  is_ai_eligible?: boolean;
};

export type DeptBreakdown = {
  department_id: string;
  department_name: string;
  deliverables: Deliverable[];
  tasks: BreakdownTask[];
  human_hours_low: number;
  human_hours_mid: number;
  human_hours_high: number;
  ai_hours: number;
};

export type OpenQuestion = { question: string; context: string };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no new errors referencing `src/types/brief-intelligence.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/brief-intelligence.ts
git commit -m "feat(briefs): shared brief-intelligence JSONB types"
```

---

### Task 2: Pure estimate helpers

**Files:**
- Create: `src/lib/brief-estimate.ts`
- Test: `src/lib/brief-estimate.test.ts`

**Interfaces:**
- Consumes: `DeptBreakdown` from Task 1.
- Produces:
  - `recomputeTotals(breakdown: DeptBreakdown[]): HourTotals` where `HourTotals = { total_human_hours_low, total_human_hours_mid, total_human_hours_high, total_ai_hours }` (all numbers).
  - `computeEstimatedPriceCents(breakdown: DeptBreakdown[], rateByDeptId: Map<string, number>): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/brief-estimate.test.ts
import { describe, it, expect } from "vitest";
import { recomputeTotals, computeEstimatedPriceCents } from "./brief-estimate";
import type { DeptBreakdown } from "@/types/brief-intelligence";

const dept = (o: Partial<DeptBreakdown>): DeptBreakdown => ({
  department_id: "d1",
  department_name: "Dev",
  deliverables: [],
  tasks: [],
  human_hours_low: 0,
  human_hours_mid: 0,
  human_hours_high: 0,
  ai_hours: 0,
  ...o,
});

describe("recomputeTotals", () => {
  it("sums per-department hours", () => {
    const r = recomputeTotals([
      dept({ human_hours_low: 1, human_hours_mid: 2, human_hours_high: 3, ai_hours: 0.5 }),
      dept({ human_hours_low: 2, human_hours_mid: 3, human_hours_high: 4, ai_hours: 1 }),
    ]);
    expect(r).toEqual({
      total_human_hours_low: 3,
      total_human_hours_mid: 5,
      total_human_hours_high: 7,
      total_ai_hours: 1.5,
    });
  });

  it("returns zeros for empty breakdown", () => {
    expect(recomputeTotals([])).toEqual({
      total_human_hours_low: 0,
      total_human_hours_mid: 0,
      total_human_hours_high: 0,
      total_ai_hours: 0,
    });
  });
});

describe("computeEstimatedPriceCents", () => {
  it("multiplies high hours by dept rate and sums", () => {
    const rates = new Map([["d1", 100000], ["d2", 50000]]);
    const price = computeEstimatedPriceCents(
      [
        dept({ department_id: "d1", human_hours_high: 4 }),
        dept({ department_id: "d2", human_hours_high: 2.5 }),
      ],
      rates,
    );
    expect(price).toBe(525000);
  });

  it("treats missing rate as zero", () => {
    const price = computeEstimatedPriceCents(
      [dept({ department_id: "x", human_hours_high: 5 })],
      new Map(),
    );
    expect(price).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/brief-estimate.test.ts`
Expected: FAIL — module `./brief-estimate` not found.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/brief-estimate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brief-estimate.ts src/lib/brief-estimate.test.ts
git commit -m "feat(briefs): pure recompute helpers for brief hours + price"
```

---

### Task 3: Update mutation + poll-pause in the data hook

**Files:**
- Modify: `src/hooks/useBriefIntelligence.ts`

**Interfaces:**
- Consumes: existing `KEY`, `supabase`, `Database`.
- Produces:
  - `useBriefIntelligence(briefId, opts?: { paused?: boolean })` — when `paused` is true, the 5s poll is disabled.
  - `useUpdateBriefIntelligence(briefId): mutation` with `mutateAsync(patch: BriefIntelligenceUpdate)`.

- [ ] **Step 1: Add poll-pause parameter**

Replace the `useBriefIntelligence` function (lines 12-30) with:

```ts
export function useBriefIntelligence(
  briefId: string | undefined,
  opts?: { paused?: boolean },
) {
  const paused = opts?.paused ?? false;
  return useQuery({
    queryKey: KEY(briefId),
    queryFn: async (): Promise<BriefIntelligence | null> => {
      if (!briefId) return null;
      const { data, error } = await supabase
        .from("brief_intelligence")
        .select("*")
        .eq("brief_id", briefId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!briefId,
    // Poll every 5s while pending so the UI updates when intake finishes —
    // paused while the AM is editing so a refetch can't clobber the draft.
    refetchInterval: (query) =>
      !paused && query.state.data?.am_status === "pending" ? 5000 : false,
  });
}
```

- [ ] **Step 2: Add the update mutation**

Add after the `type BriefIntelligence = ...` line (near the top):

```ts
type BriefIntelligenceUpdate =
  Database["public"]["Tables"]["brief_intelligence"]["Update"];
```

Add at the end of the file:

```ts
export function useUpdateBriefIntelligence(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: BriefIntelligenceUpdate) => {
      const { data, error } = await supabase
        .from("brief_intelligence")
        .update(patch)
        .eq("brief_id", briefId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(briefId) });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no new errors in `src/hooks/useBriefIntelligence.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBriefIntelligence.ts
git commit -m "feat(briefs): update mutation + poll-pause for brief intelligence"
```

---

### Task 4: Edit mode in BriefIntelligenceView

**Files:**
- Modify (full rewrite): `src/components/BriefIntelligenceView.tsx`

**Interfaces:**
- Consumes: shared types (Task 1), `recomputeTotals` / `computeEstimatedPriceCents` (Task 2), `BriefIntelligenceUpdate` (from db types).
- Produces: `BriefIntelligenceView` props `{ intelligence, isLoading, departments?: { id: string; hourly_rate_cents: number }[], onSave?: (patch: BriefIntelligenceUpdate) => Promise<void>, onEditingChange?: (editing: boolean) => void }`.

- [ ] **Step 1: Replace the whole file**

```tsx
// src/components/BriefIntelligenceView.tsx
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const CONFIDENCE_COLOURS: Record<string, string> = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
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

  const confidenceClass =
    CONFIDENCE_COLOURS[intelligence.confidence_level ?? "low"] ??
    CONFIDENCE_COLOURS.low;

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
              <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
                Brief Summary
              </span>
              {intelligence.confidence_level && (
                <Badge variant="outline" className={`text-label-small ${confidenceClass}`}>
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
                      <span className="ml-2 text-m-primary">· {dept.ai_hours} hrs AI</span>
                    )}
                  </span>
                </div>
                {dept.deliverables?.length > 0 && (
                  <ul className="ml-3 space-y-1">
                    {dept.deliverables.map((d, j) => (
                      <li key={j} className="text-body-small text-m-on-surface-variant">
                        ∟ {d.name}
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
                  {intelligence.total_human_hours_low ?? "?"}–
                  {intelligence.total_human_hours_high ?? "?"} hrs
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
                <div className="text-title-medium">{zar(intelligence.estimated_price_cents)}</div>
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
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
            Brief Summary
          </span>
          <select
            className="text-label-small rounded border bg-transparent px-2 py-1"
            value={draft.confidence_level}
            onChange={(e) => update({ confidence_level: e.target.value })}
          >
            <option value="low">low confidence</option>
            <option value="medium">medium confidence</option>
            <option value="high">high confidence</option>
          </select>
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
          <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
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
        <span className="text-label-small font-medium text-m-on-surface-variant uppercase tracking-wide">
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
            {totals.total_human_hours_low}–{totals.total_human_hours_high} hrs
          </div>
          {totals.total_ai_hours > 0 && (
            <div className="text-body-small text-m-primary">+ {totals.total_ai_hours} hrs AI</div>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-label-small text-m-on-surface-variant">Estimated price</div>
          <div className="flex items-center gap-1">
            <span className="text-title-medium">R</span>
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
              reset to computed ({zar(computedPrice)})
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
          <span className="text-label-small font-medium text-yellow-800 uppercase tracking-wide">
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no new errors in `src/components/BriefIntelligenceView.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/BriefIntelligenceView.tsx src/types/brief-intelligence.ts
git commit -m "feat(briefs): edit mode for brief intelligence view"
```

---

### Task 5: Wire into Scope.tsx

**Files:**
- Modify: `src/pages/Scope.tsx`

**Interfaces:**
- Consumes: `useDepartments` (`src/hooks/useDepartments.ts`), `useUpdateBriefIntelligence` (Task 3), `BriefIntelligenceView` props (Task 4).

- [ ] **Step 1: Add imports**

Add to the hook import block:

```tsx
import { useDepartments } from "@/hooks/useDepartments";
```

Extend the `useBriefIntelligence` import line to include the update hook:

```tsx
import {
  useBriefIntelligence,
  useApproveBriefIntelligence,
  useRejectBriefIntelligence,
  useUpdateBriefIntelligence,
} from "@/hooks/useBriefIntelligence";
```

- [ ] **Step 2: Add state + hooks in the component body**

Add an editing flag and pass it to the poll; add departments + update mutation. Replace the `const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id);` line and add below the existing hook calls:

```tsx
  const [editingIntel, setEditingIntel] = useState(false);
  const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id, {
    paused: editingIntel,
  });
  const { data: departments } = useDepartments();
  const updateIntel = useUpdateBriefIntelligence(id ?? "");
```

(Leave the existing `const { data: brief } = useBrief(id);` line as-is above it.)

- [ ] **Step 3: Pass edit props to BriefIntelligenceView**

Replace the `<BriefIntelligenceView ... />` block (lines ~152-155) with:

```tsx
      <BriefIntelligenceView
        intelligence={intelligence ?? null}
        isLoading={intelLoading}
        departments={departments}
        onEditingChange={setEditingIntel}
        onSave={async (patch) => {
          try {
            await updateIntel.mutateAsync(patch);
            toast.success("Brief updated");
          } catch (e) {
            toast.error("Failed to save changes");
            throw e;
          }
        }}
      />
```

- [ ] **Step 4: Hide the AM review action bar while editing**

Change the review-card guard from:

```tsx
      {!isApproved && !isRejected && intelligence && (
```

to:

```tsx
      {!isApproved && !isRejected && intelligence && !editingIntel && (
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no new errors in `src/pages/Scope.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Scope.tsx
git commit -m "feat(briefs): wire edit mode + poll-pause into scope review"
```

---

## Verification

- [ ] `npx vitest run src/lib/brief-estimate.test.ts` → PASS.
- [ ] `npx tsc -b` → no new errors introduced by these files.
- [ ] Run the app (`npm run dev -- --port 5391`) and on a pending brief's Scope screen:
  - Edit → sections become inputs; Approve/Reject bar disappears.
  - Change a department's high hours → total hours and computed price update live.
  - Override the price → holds; "reset to computed" restores the formula value.
  - Add/remove a requirement, deliverable, task, open question.
  - Save → persists, returns to read-only with the new numbers; Approve still works.
  - Cancel → discards changes.
  - Confirm the 5s poll does not clobber edits mid-session.

## Self-Review

- **Spec coverage:** edit-mode toggle (Task 4), all editable fields (Task 4), live totals + overridable price (Tasks 2+4), save recompute + mutation (Tasks 2+3+4), poll pause + action-bar hide (Tasks 3+5), shared types + pure helpers files (Tasks 1+2). All spec sections covered.
- **Placeholder scan:** none — all steps carry full code.
- **Type consistency:** `recomputeTotals`/`computeEstimatedPriceCents` signatures match between Task 2, its tests, and Task 4 usage; `DeptBreakdown`/`Requirement`/`OpenQuestion` names match across Tasks 1/4; `useUpdateBriefIntelligence(briefId)` + `useBriefIntelligence(id, { paused })` match between Tasks 3 and 5; `BriefIntelligenceView` props match between Tasks 4 and 5.
