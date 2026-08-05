// src/pages/SystemDetail.tsx
//
// /systems/:id — one system: goal, owner, steps, and (kind='internal' only) an
// overhead-vs-estimate read. The drag-and-drop canvas is Phase 6 — this page
// only reserves its slot. ZERO ClickUp writes happen from this page.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, LayoutPanelTop } from "lucide-react";
import {
  PLACEHOLDER_GOAL,
  SYSTEM_BANDS,
  SYSTEM_BAND_LABEL,
  SYSTEM_KIND_LABEL,
  useSystemDefinition,
  useSystemOverhead,
  useUpdateSystem,
  type SystemDefinitionWithJoins,
} from "@/hooks/useSystemDefinitions";
import { useSystemSteps } from "@/hooks/useProcessSteps";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MATERIALISE_LABEL: Record<string, string> = {
  task: "Task",
  checklist_item: "Checklist item",
  none: "Not materialised",
};

type FormState = {
  name: string;
  band: string;
  owner_id: string;
  expert_id: string;
  review_due_at: string;
  goal_statement: string;
  goal_metric: string;
  trigger_text: string;
  definition_of_done: string;
  exceptions_md: string;
};

function toForm(s: SystemDefinitionWithJoins): FormState {
  return {
    name: s.name,
    band: s.band ?? "",
    owner_id: s.owner_id ?? "",
    expert_id: s.expert_id ?? "",
    review_due_at: s.review_due_at ?? "",
    goal_statement: s.goal_statement,
    goal_metric: s.goal_metric ?? "",
    trigger_text: s.trigger_text ?? "",
    definition_of_done: s.definition_of_done ?? "",
    exceptions_md: s.exceptions_md ?? "",
  };
}

export function SystemDetail() {
  const { id } = useParams();
  const { data: system, isLoading } = useSystemDefinition(id);
  const { data: steps = [] } = useSystemSteps(id);
  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();
  const update = useUpdateSystem();

  const deptById = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const teamById = useMemo(() => new Map(team.map((t) => [t.id, t])), [team]);

  const [form, setForm] = useState<FormState | null>(null);

  // Re-seed whenever the *identity* of the system changes (route param swap
  // or first load) — not on every background refetch, which would clobber an
  // in-progress edit. Same convention as ServiceDetail.tsx.
  useEffect(() => {
    if (system) setForm(toForm(system));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system?.id]);

  function save<K extends keyof FormState>(field: K, raw: string) {
    if (!id || !system) return;
    const value = raw.trim();
    if (field === "name" && !value) {
      toast.error("Name can't be empty");
      setForm(toForm(system));
      return;
    }
    if (field === "goal_statement" && !value) {
      toast.error("Goal can't be empty — a system must always have a goal");
      setForm(toForm(system));
      return;
    }
    const nullable = new Set<keyof FormState>([
      "band",
      "owner_id",
      "expert_id",
      "review_due_at",
      "goal_metric",
      "trigger_text",
      "definition_of_done",
      "exceptions_md",
    ]);
    const patchValue = value || (nullable.has(field) ? null : value);
    update.mutate(
      { id, patch: { [field]: patchValue } },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save") },
    );
  }

  // Three separate single-condition guards (not one combined check) so each
  // narrows cleanly: isLoading, then a genuinely-missing system (bad/deleted
  // id — resolves isLoading=false with no row), THEN the one-tick gap before
  // the effect above seeds `form`. Checking `!form` before `!system` would
  // report "Loading…" forever for a bad id, since the effect that sets form
  // is itself gated on `system` existing.
  if (isLoading) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }
  if (!system) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">System not found.</div>;
  }
  if (!form) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }

  const linkLabel =
    system.kind === "service"
      ? system.service_name
      : system.kind === "recurring"
        ? system.recurring_service_name
        : system.kind === "internal"
          ? system.time_category_label
          : null;

  const totalStepHours = steps.reduce((sum, s) => sum + (s.estimated_hours ?? 0), 0);
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to="/systems"><ArrowLeft className="h-4 w-4" /> Systems</Link>
          </Button>

        {/* Header */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={(e) => save("name", e.target.value)}
                  aria-label="System name"
                  className="h-auto border-none px-0 text-headline-small font-semibold shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{SYSTEM_KIND_LABEL[system.kind]}</Badge>
                  {linkLabel && <span className="text-label-small text-m-on-surface-variant">{linkLabel}</span>}
                  {isUnmapped && <Badge variant="warning">No goal set</Badge>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <FieldLabel label="Band">
                <select
                  value={form.band}
                  onChange={(e) => {
                    setForm({ ...form, band: e.target.value });
                    save("band", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— none</option>
                  {SYSTEM_BANDS.map((b) => (
                    <option key={b} value={b}>{SYSTEM_BAND_LABEL[b]}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Owner">
                <select
                  value={form.owner_id}
                  onChange={(e) => {
                    setForm({ ...form, owner_id: e.target.value });
                    save("owner_id", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— unassigned</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Expert">
                <select
                  value={form.expert_id}
                  onChange={(e) => {
                    setForm({ ...form, expert_id: e.target.value });
                    save("expert_id", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— unassigned</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Review due">
                <Input
                  type="date"
                  value={form.review_due_at}
                  onChange={(e) => setForm({ ...form, review_due_at: e.target.value })}
                  onBlur={(e) => save("review_due_at", e.target.value)}
                  className="h-9"
                />
              </FieldLabel>
            </div>
          </CardContent>
        </Card>

        {/* Goal — the point of the feature. Prominent, always visible, editable. */}
        <Card className="border-m-primary/40 bg-m-primary-container/15">
          <CardHeader>
            <CardTitle className="text-title-medium">Goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={form.goal_statement}
              onChange={(e) => setForm({ ...form, goal_statement: e.target.value })}
              onBlur={(e) => save("goal_statement", e.target.value)}
              rows={2}
              className="text-body-large"
              placeholder="What does this system exist to achieve?"
            />
            <div className="space-y-1">
              <Label htmlFor="goal-metric">Goal metric</Label>
              <Input
                id="goal-metric"
                value={form.goal_metric}
                onChange={(e) => setForm({ ...form, goal_metric: e.target.value })}
                onBlur={(e) => save("goal_metric", e.target.value)}
                placeholder="e.g. 20 qualified leads / month"
              />
            </div>
          </CardContent>
        </Card>

        {/* Trigger / definition of done / exceptions */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <FieldLabel label="Trigger" stacked>
              <Textarea
                value={form.trigger_text}
                onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
                onBlur={(e) => save("trigger_text", e.target.value)}
                rows={2}
                placeholder="What kicks this system off?"
              />
            </FieldLabel>
            <FieldLabel label="Definition of done" stacked>
              <Textarea
                value={form.definition_of_done}
                onChange={(e) => setForm({ ...form, definition_of_done: e.target.value })}
                onBlur={(e) => save("definition_of_done", e.target.value)}
                rows={2}
                placeholder="How do we know this system's work is complete?"
              />
            </FieldLabel>
            <FieldLabel label="Exceptions" stacked>
              <Textarea
                value={form.exceptions_md}
                onChange={(e) => setForm({ ...form, exceptions_md: e.target.value })}
                onBlur={(e) => save("exceptions_md", e.target.value)}
                rows={2}
                placeholder="Edge cases this system doesn't cover"
              />
            </FieldLabel>
          </CardContent>
        </Card>

        {/* Steps — read-only-ish list. Full editing is Phase 6's canvas. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-title-medium">
              Steps <span className="text-label-medium font-normal text-m-on-surface-variant">· {steps.length}</span>
            </CardTitle>
            {totalStepHours > 0 && (
              <span className="font-mono text-label-medium text-m-on-surface-variant">{totalStepHours}h estimated</span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {steps.length === 0 ? (
              <p className="px-5 pb-5 text-body-medium text-m-on-surface-variant">
                No steps yet.
              </p>
            ) : (
              <ol className="divide-y divide-m-outline-variant">
                {steps.map((s) => {
                  const dept = s.department_id ? deptById.get(s.department_id) : null;
                  const owner = s.owner_id ? teamById.get(s.owner_id) : null;
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="w-5 flex-none text-center font-mono text-label-small text-m-on-surface-variant">
                        {s.ordinal}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-medium text-m-on-surface">{s.title}</p>
                        <p className="flex items-center gap-1.5 truncate text-label-small text-m-on-surface-variant">
                          <span
                            className="h-2 w-2 flex-none rounded-full"
                            style={{ background: dept?.color ?? "var(--mcolor-outline-variant)" }}
                          />
                          {dept?.name ?? "No department"}{owner ? ` · ${owner.full_name}` : ""}
                        </p>
                      </div>
                      <Badge variant="muted" className="flex-none text-label-small">
                        {MATERIALISE_LABEL[s.materialise_as] ?? s.materialise_as}
                      </Badge>
                      <span className="w-14 flex-none text-right font-mono text-label-small text-m-on-surface-variant">
                        {s.estimated_hours != null ? `${s.estimated_hours}h` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {system.kind === "internal" && (
          <OverheadPanel system={system} totalStepHours={totalStepHours} />
        )}

        {/* Phase 6 placeholder */}
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <LayoutPanelTop className="h-6 w-6 text-m-on-surface-variant" />
            <p className="text-title-small text-m-on-surface">Canvas — Phase 6</p>
            <p className="max-w-sm text-body-small text-m-on-surface-variant">
              Drag-and-drop visual mapping of this system's steps, handoffs and department
              ownership lands in a later phase.
            </p>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  stacked,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", stacked && "space-y-1.5")}>
      <Label className="text-label-small text-m-on-surface-variant">{label}</Label>
      {children}
    </div>
  );
}

function OverheadPanel({
  system,
  totalStepHours,
}: {
  system: SystemDefinitionWithJoins;
  totalStepHours: number;
}) {
  const { data: actualHours = 0, isLoading } = useSystemOverhead(system.time_category_id);
  const variancePct = totalStepHours > 0 ? Math.round((actualHours / totalStepHours) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-title-medium">Overhead consumed</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-8">
            <Stat label="Actual (all-time)" value={`${actualHours.toFixed(1)}h`} />
            <Stat label="Estimated (steps)" value={totalStepHours > 0 ? `${totalStepHours.toFixed(1)}h` : "—"} />
            {variancePct !== null && (
              <Stat label="vs. estimate" value={`${variancePct}%`} warn={variancePct > 120} />
            )}
          </div>
        )}
        <p className="mt-3 text-label-small text-m-on-surface-variant">
          Summed from every team member's perpetual [Internal] task for{" "}
          {system.time_category_label ?? "this time category"}. Read-only — no ClickUp tasks are
          created or changed from this page.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-label-small text-m-on-surface-variant">{label}</p>
      <p className={cn("font-mono text-title-large", warn ? "text-m-error" : "text-m-on-surface")}>{value}</p>
    </div>
  );
}
