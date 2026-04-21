import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, Save, RotateCcw, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useProcessSteps, useReplaceSteps, useUpdateStep, useDeleteStep, useCreateStep } from "@/hooks/useProcessSteps";
import { useDepartments } from "@/hooks/useDepartments";
import { useRules } from "@/hooks/useRules";
import { useSetServiceChecklist } from "@/hooks/useServices";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChecklistSummary } from "@/components/ChecklistSummary";
import { SaveAsRuleModal } from "@/components/SaveAsRuleModal";
import { supabase } from "@/lib/supabase";

interface Props {
  serviceId: string;
  priceCents: number;
  pricingModel: string;
  ruleId: string | null;
}

export function ProcessFlow({ serviceId, priceCents, pricingModel, ruleId }: Props) {
  const { data: steps = [], isLoading } = useProcessSteps(serviceId);
  const { data: depts = [] } = useDepartments();
  const update = useUpdateStep();
  const remove = useDeleteStep();
  const create = useCreateStep();
  const replace = useReplaceSteps();
  const [aiLoading, setAiLoading] = useState(false);

  const { data: rules = [] } = useRules();
  const setChecklist = useSetServiceChecklist();
  const [showSaveAsRule, setShowSaveAsRule] = useState(false);

  const activeRule = rules.find((r) => r.id === ruleId);
  const hasChecklist = steps.some((s) => s.department_id && s.estimated_hours != null);
  const isPercentage = pricingModel === "percentage";

  async function generateAI() {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-process-steps", {
        body: { service_id: serviceId },
      });
      if (error) throw error;
      if (!data?.steps) throw new Error("No steps returned");
      if (steps.length > 0 && !confirm("Replace existing process steps with AI-generated set?")) return;
      await replace.mutateAsync({
        serviceId,
        steps: data.steps.map((s: { title: string; description?: string; department_id: string | null; estimated_hours?: number | null }, i: number) => ({
          ordinal: i + 1,
          title: s.title,
          description: s.description ?? null,
          department_id: s.department_id ?? null,
          estimated_hours: s.estimated_hours ?? null,
          ai_generated: true,
        })),
      });
      toast.success(`Generated ${data.steps.length} steps`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setAiLoading(false);
    }
  }

  function moveStep(id: string, direction: -1 | 1) {
    const i = steps.findIndex((s) => s.id === id);
    const j = i + direction;
    if (j < 0 || j >= steps.length) return;
    const a = steps[i], b = steps[j];
    // swap ordinals (two separate updates; ordinals unique per service)
    update.mutate({ id: a.id, patch: { ordinal: b.ordinal + 10000 } });
    setTimeout(() => {
      update.mutate({ id: b.id, patch: { ordinal: a.ordinal } });
      update.mutate({ id: a.id, patch: { ordinal: b.ordinal } });
    }, 50);
  }

  function addStep() {
    const nextOrdinal = steps.length > 0 ? Math.max(...steps.map((s) => s.ordinal)) + 1 : 1;
    create.mutate({
      service_id: serviceId,
      ordinal: nextOrdinal,
      title: "New step",
      department_id: null,
      estimated_hours: null,
    });
  }

  function seedFromRule() {
    if (!activeRule || !activeRule.allocations) return;
    if (steps.length > 0 && !confirm("Replace current steps with rule-seeded defaults?")) return;
    const rows = activeRule.allocations
      .filter((a) => Number(a.pct) > 0)
      .map((a, i) => {
        const dept = depts.find((d) => d.id === a.department_id);
        const rate = dept?.hourly_rate_cents ?? 0;
        let hours = rate > 0 && priceCents > 0
          ? (Number(a.pct) * priceCents) / rate / 100
          : 0.25;
        hours = Math.max(0.25, Math.round(hours / 0.25) * 0.25);
        return {
          ordinal: i + 1,
          title: `${dept?.name ?? "Dept"} — work`,
          description: null,
          department_id: a.department_id,
          estimated_hours: hours,
          ai_generated: false,
        };
      });
    replace.mutate(
      { serviceId, steps: rows },
      {
        onSuccess: () => toast.success(`Seeded ${rows.length} steps from "${activeRule.name}"`),
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  function clearChecklist() {
    if (!confirm("Delete all steps and fall back to rule allocation?")) return;
    setChecklist.mutate(
      { kind: "clear", serviceId },
      {
        onSuccess: () => toast.success("Checklist cleared; service is now using its rule."),
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Process flow</h3>
            <p className="text-xs text-muted-foreground">
              {hasChecklist
                ? `Custom checklist · ${steps.length} steps. Drives dept allocation.`
                : activeRule
                  ? `Using rule: ${activeRule.name}. Seed to customize.`
                  : "No rule or checklist. Add steps manually or generate with AI."}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={generateAI} disabled={aiLoading}>
              <Sparkles className="h-4 w-4" /> {aiLoading ? "Generating…" : "Generate with AI"}
            </Button>
            {!hasChecklist && activeRule && (
              <Button variant="outline" size="sm" onClick={seedFromRule} disabled={replace.isPending}>
                <FileDown className="h-4 w-4" /> Seed from rule
              </Button>
            )}
            {hasChecklist && !isPercentage && priceCents > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowSaveAsRule(true)}>
                <Save className="h-4 w-4" /> Save as rule
              </Button>
            )}
            {hasChecklist && (
              <Button variant="ghost" size="sm" onClick={clearChecklist} disabled={setChecklist.isPending}>
                <RotateCcw className="h-4 w-4" /> Clear checklist
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={addStep}>
              <Plus className="h-4 w-4" /> Add step
            </Button>
          </div>
        </div>

        {(hasChecklist || steps.length > 0) && (
          <ChecklistSummary
            steps={steps}
            departments={depts}
            priceCents={priceCents}
            pricingModel={pricingModel}
          />
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : steps.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No process steps yet. Add one manually, seed from the rule, or let AI draft them.
        </p>
      ) : (
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.id} className="rounded-md border bg-background p-3">
              <div className="flex items-start gap-3">
                <div className="text-xs font-mono text-muted-foreground pt-2">{i + 1}</div>
                <div className="flex-1 space-y-2">
                  <Input
                    defaultValue={s.title}
                    onBlur={(e) => {
                      if (e.target.value !== s.title)
                        update.mutate({ id: s.id, patch: { title: e.target.value } });
                    }}
                  />
                  <Textarea
                    defaultValue={s.description ?? ""}
                    placeholder="Description (optional)"
                    rows={2}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== s.description)
                        update.mutate({ id: s.id, patch: { description: v } });
                    }}
                  />
                  <div className="flex items-center gap-2 text-sm">
                    <select
                      defaultValue={s.department_id ?? ""}
                      onChange={(e) =>
                        update.mutate({ id: s.id, patch: { department_id: e.target.value || null } })
                      }
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— department</option>
                      {depts.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      step="0.25"
                      min="0.25"
                      className="h-8 w-24"
                      placeholder="hours"
                      defaultValue={s.estimated_hours != null ? String(s.estimated_hours) : ""}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") {
                          update.mutate({ id: s.id, patch: { estimated_hours: null } });
                          return;
                        }
                        const n = Number(raw);
                        if (!Number.isFinite(n) || n < 0.25) {
                          toast.error("Step hours must be at least 0.25");
                          e.target.value = s.estimated_hours != null ? String(s.estimated_hours) : "";
                          return;
                        }
                        const rounded = Math.round(n / 0.25) * 0.25;
                        e.target.value = String(rounded);
                        update.mutate({ id: s.id, patch: { estimated_hours: rounded } });
                      }}
                    />
                    {s.ai_generated && <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> AI</Badge>}
                  </div>
                </div>
                <div className="flex flex-col">
                  <Button size="icon" variant="ghost" onClick={() => moveStep(s.id, -1)} disabled={i === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => moveStep(s.id, 1)} disabled={i === steps.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate({ id: s.id, serviceId })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <SaveAsRuleModal
        open={showSaveAsRule}
        onClose={() => setShowSaveAsRule(false)}
        steps={steps}
        departments={depts}
        priceCents={priceCents}
        onSaved={() => { /* rules page invalidates its own query */ }}
      />
    </div>
  );
}
