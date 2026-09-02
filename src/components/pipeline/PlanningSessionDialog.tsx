// src/components/pipeline/PlanningSessionDialog.tsx
//
// The five questions the source decks name, answered once and DERIVED into
// twelve themed months — never typed in directly. Every keystroke re-runs
// deriveMonths/seedTasks/planningWarnings (src/lib/pipeline-year.ts, pure, no
// network) so the right-hand preview is always what "Map the year" is about
// to write, not a guess at it.
//
// Doubles as the re-plan dialog (0150's replan_school_year): passing
// `existing` locks the start date (a running year does not move) and swaps
// the mutation and the CTA copy. The five-question shape and the live
// preview are identical either way — re-planning is answering the same
// questions again, not a different screen.
//
// "Year starts" is not one of the five named questions, but deriveMonths
// needs a first month to count from and nothing else in the brief supplies
// one — it defaults to today and is the one field a fresh planning session
// can still edit.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import {
  deriveMonths,
  planningWarnings,
  seedTasks,
  type PlanningAnswers,
  type PlanningWarning,
  type TemplateTask,
  type TemplateTheme,
} from "@/lib/pipeline-year";
import { useCreateSchoolYear, useReplanSchoolYear } from "@/hooks/useSchoolYear";

const EMPTY_ANSWERS: PlanningAnswers = {
  applications_open_on: null,
  applications_close_on: null,
  open_days: [],
  offers_out_on: null,
  deposits_due_on: null,
  budget_set_month: null,
  grade_variations: "",
};

function warningLine(w: PlanningWarning): string {
  switch (w.kind) {
    case "open_day_in_pinned_month":
      return `An open day on ${w.date} falls in M${w.month_no}, a fixed month — it was not placed as an open-day month.`;
    case "open_day_outside_year":
      return `${w.date} falls outside this twelve-month year and was ignored.`;
    case "six_week_breach":
      return `M${w.month_no}'s open day (${w.date}) leaves only ${w.days} day(s) of run-up — under the six-week minimum.`;
    case "build_month_unplaced":
      return `The open day on ${w.date} has no build month${
        w.blocked_by_month_no ? ` — M${w.blocked_by_month_no} is already taken` : ""
      }, so "Build the open day machine" was not seeded for it.`;
  }
}

export function PlanningSessionDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  template,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** From usePipelineTemplate() — null while it's loading or none is configured. */
  template: { templateId: string; themes: TemplateTheme[]; tasks: TemplateTask[] } | null;
  /** Present → this is a re-plan of a running year, not its first creation. */
  existing?: { yearId: string; startedOn: string; openDays: string[]; answers: PlanningAnswers } | null;
  onSaved?: (yearId: string) => void;
}) {
  const create = useCreateSchoolYear();
  const replan = useReplanSchoolYear();
  const busy = create.isPending || replan.isPending;

  const [startedOn, setStartedOn] = useState(existing?.startedOn ?? todayISO());
  // Mirrors the effect below: even while closed, this component's body still
  // runs, so a jsonb answers payload without open_days (there is none live
  // today, but the type doesn't guarantee it) must not throw here.
  const [answers, setAnswers] = useState<PlanningAnswers>(
    existing ? { ...existing.answers, open_days: existing.openDays } : EMPTY_ANSWERS,
  );

  useEffect(() => {
    if (!open) return;
    setStartedOn(existing?.startedOn ?? todayISO());
    // The DB column (existing.openDays) is the record; planning_answers is
    // only a transcript of the last session's questions — seed open_days
    // from the column, everything else from the answers (D1).
    setAnswers(existing ? { ...existing.answers, open_days: existing.openDays } : EMPTY_ANSWERS);
    // Only re-seed from `existing` when the dialog opens — not on every
    // render, or a keystroke would fight the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Real dates, deduped and sorted — blank rows (mid-edit) never reach
  // deriveMonths/planningWarnings or get written.
  const cleanOpenDays = useMemo(
    () => Array.from(new Set(answers.open_days.filter((d) => d))).sort(),
    [answers.open_days],
  );

  function setOpenDay(i: number, date: string) {
    const next = [...answers.open_days];
    next[i] = date;
    setAnswers({ ...answers, open_days: next });
  }
  function addOpenDay() {
    setAnswers({ ...answers, open_days: [...answers.open_days, ""] });
  }
  function removeOpenDay(i: number) {
    setAnswers({ ...answers, open_days: answers.open_days.filter((_, idx) => idx !== i) });
  }

  const months = useMemo(
    () => (template ? deriveMonths(startedOn, cleanOpenDays, template.themes) : []),
    [template, startedOn, cleanOpenDays],
  );
  const seeded = useMemo(() => (template ? seedTasks(months, template.tasks) : []), [template, months]);
  const warnings = useMemo(
    () => planningWarnings(startedOn, cleanOpenDays, months),
    [startedOn, cleanOpenDays, months],
  );

  const ready = !!template && !!startedOn;

  async function mapTheYear() {
    if (!template) return;
    const finalAnswers: PlanningAnswers = { ...answers, open_days: cleanOpenDays };
    try {
      if (existing) {
        await replan.mutateAsync({
          yearId: existing.yearId,
          openDays: cleanOpenDays,
          answers: finalAnswers,
          months,
          tasks: seeded,
        });
        toast.success("Re-planned. Future months are re-themed; anything already touched was left alone.");
        onSaved?.(existing.yearId);
      } else {
        const yearId = await create.mutateAsync({
          clientId,
          templateId: template.templateId,
          startedOn,
          openDays: cleanOpenDays,
          answers: finalAnswers,
          accountOwnerId: null,
          months,
          tasks: seeded,
        });
        toast.success(`${clientName}'s year is mapped.`);
        onSaved?.(yearId);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{existing ? `Re-plan ${clientName}'s year` : `Plan ${clientName}'s year`}</DialogTitle>
          <DialogDescription>
            Five questions, derived into twelve months. Nothing is written until you map the year.
          </DialogDescription>
        </DialogHeader>

        {/* The two columns scroll independently. Scrolling down to question 5
         *  must not carry the derived year off-screen — watching it re-derive as
         *  you answer IS the feedback loop, and a single scroll region breaks it.
         *  min-h-0 is load-bearing on all three: a flex/grid child defaults to
         *  min-height:auto, refuses to shrink below its content, and pushes the
         *  footer past the dialog's own max-height on a short screen. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden md:grid-cols-2">
          {/* LEFT — the questions */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-started">Year starts</Label>
              <Input
                id="ps-started"
                type="date"
                className="w-44"
                value={startedOn}
                disabled={!!existing}
                onChange={(e) => setStartedOn(e.target.value)}
              />
              {existing ? (
                <p className="text-body-small text-m-on-surface-variant">A running year keeps its own start date.</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>1. When do applications open and close?</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={answers.applications_open_on ?? ""}
                  onChange={(e) => setAnswers({ ...answers, applications_open_on: e.target.value || null })}
                />
                <span className="text-m-on-surface-variant">→</span>
                <Input
                  type="date"
                  value={answers.applications_close_on ?? ""}
                  onChange={(e) => setAnswers({ ...answers, applications_close_on: e.target.value || null })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>2. When are the open days?</Label>
              <div className="flex flex-col gap-1.5">
                {answers.open_days.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="date" className="w-44" value={d} onChange={(e) => setOpenDay(i, e.target.value)} />
                    <button
                      type="button"
                      onClick={() => removeOpenDay(i)}
                      aria-label="Remove this open day"
                      className="grid h-8 w-8 flex-none place-items-center rounded-md text-m-on-surface-variant transition-colors hover:bg-m-surface-container motion-reduce:transition-none"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addOpenDay}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Add an open day
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>3. When do offers go out, and deposits fall due?</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={answers.offers_out_on ?? ""}
                  onChange={(e) => setAnswers({ ...answers, offers_out_on: e.target.value || null })}
                />
                <span className="text-m-on-surface-variant">→</span>
                <Input
                  type="date"
                  value={answers.deposits_due_on ?? ""}
                  onChange={(e) => setAnswers({ ...answers, deposits_due_on: e.target.value || null })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-budget">4. When does the school set its budget?</Label>
              <Input
                id="ps-budget"
                type="month"
                className="w-44"
                value={answers.budget_set_month ? answers.budget_set_month.slice(0, 7) : ""}
                onChange={(e) => setAnswers({ ...answers, budget_set_month: e.target.value ? `${e.target.value}-01` : null })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-grades">5. Does the cycle differ by grade?</Label>
              <Textarea
                id="ps-grades"
                rows={2}
                value={answers.grade_variations}
                onChange={(e) => setAnswers({ ...answers, grade_variations: e.target.value })}
                placeholder="e.g. Grade 000–R apply on a rolling basis; Grade 1 follows the main cycle."
              />
            </div>
          </div>

          {/* RIGHT — the derived year, live */}
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
            <p className="text-label-large text-m-on-surface">The derived year</p>
            {!template ? (
              <p className="text-body-small text-m-on-surface-variant">
                No pipeline template is set up (Settings). Nothing can be derived until one is.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {months.map((m) => (
                  <div
                    key={m.month_no}
                    className="flex items-center justify-between gap-2 rounded-md bg-m-surface-container px-2.5 py-1.5"
                  >
                    <span className="text-label-medium text-m-on-surface">
                      M{m.month_no} · {m.theme}
                    </span>
                    <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
                      {seeded.filter((t) => t.month_no === m.month_no).length} tasks
                    </span>
                  </div>
                ))}
              </div>
            )}

            {warnings.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-m-outline-variant bg-m-error-container/40 p-2.5">
                {warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-label-small text-m-on-error-container">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                    {warningLine(w)}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void mapTheYear()}
            disabled={!ready || busy}
            className="bg-gradient-brand text-white hover:opacity-90"
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            {existing ? "Re-map the year" : "Map the year"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
