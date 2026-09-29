// src/pages/PipelinePlanner.tsx
//
// /pipeline/:yearId — the per-school planner, laid out like Year results:
// the client's results groups and rows down the side, the twelve months of
// THIS school's year across (not a shared calendar — see Pipeline.tsx). Tasks
// drag or click-to-pick between months through the one useTaskMove instance
// this page owns and threads down to every TaskCard via PipelineGrid — see
// useTaskMove.ts for why there is exactly one.
//
// Legality (closed month, done task) is pipeline-move.ts's moveLegality as a
// UI affordance; the actual gate is tg_school_tasks_guard in the DB
// (0150_school_pipeline.sql "Delta B"), so a move can still come back
// refused — useMoveTask's onError already rolls the optimistic update back
// and this page surfaces the message via toast.

import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";
import { currentMonthNo, hoursByMonth } from "@/lib/pipeline-move";
import { calendarMonthNo } from "@/lib/task-clock";
import { todayISO } from "@/lib/dates";
import type { PlanningAnswers } from "@/lib/pipeline-year";
import { useSchoolYear, useMoveTask } from "@/hooks/useSchoolYear";
import { useResultsPickerGroups, useTaskLinks } from "@/hooks/useResults";
import { usePipelineTemplate } from "@/hooks/usePipelineBoard";
import { PipelineGrid } from "@/components/pipeline/PipelineGrid";
import { PlanningSessionDialog } from "@/components/pipeline/PlanningSessionDialog";
import { useTaskMove, type MovableTask } from "@/components/pipeline/useTaskMove";

export function PipelinePlanner() {
  const { yearId } = useParams<{ yearId: string }>();
  const navigate = useNavigate();
  const { data: year, isLoading, isError } = useSchoolYear(yearId);
  const { data: template } = usePipelineTemplate();
  const moveTask = useMoveTask();
  const { data: taskLinks } = useTaskLinks(yearId);
  const { data: resultsGroups } = useResultsPickerGroups(year?.clientId);
  const [replanOpen, setReplanOpen] = useState(false);

  // A yearId that doesn't resolve (bad link, deleted year) bounces to the
  // board rather than rendering a blank planner.
  useEffect(() => {
    if (isError) {
      toast.error("That school year could not be found.");
      navigate("/pipeline", { replace: true });
    }
  }, [isError, navigate]);

  const months = year?.months ?? [];
  // "Now" is the column the calendar is in (starts_on), not currentMonthNo's
  // first unclosed month: a year nobody has been closing month by month would
  // otherwise read as January in September. Outside the year's twelve months
  // it falls back to the first unclosed one.
  const current = year ? (calendarMonthNo(months, todayISO()) ?? currentMonthNo(months)) : null;
  const hours = year ? hoursByMonth(year.tasks) : new Map<number, number>();

  const movableTasks: MovableTask[] = (year?.tasks ?? []).map((t) => ({
    id: t.id,
    label: t.label,
    month_no: t.month_no,
    state: t.state,
  }));

  const move = useTaskMove({
    tasks: movableTasks,
    months,
    onMove: (taskId, toMonth) => {
      if (!year) return;
      moveTask.mutate(
        { yearId: year.id, taskId, toMonth },
        { onError: (e) => toast.error(errorMessage(e)) },
      );
    },
  });

  if (isLoading || !year) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-medium">{year.clientName}</h1>
          {year.town ? <p className="text-body-small text-m-on-surface-variant">{year.town}</p> : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setReplanOpen(true)} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> Re-run planning session
        </Button>
      </div>

      {/* One polite live region for both input paths — drag and click-to-pick
          share the same announcer (useTaskMove.ts). */}
      <p role="status" aria-live="polite" className="sr-only">
        {move.announcement}
      </p>

      <PipelineGrid
        clientId={year.clientId}
        yearId={year.id}
        months={months}
        tasks={year.tasks}
        hours={hours}
        currentMonthNo={current}
        resultsGroups={resultsGroups ?? []}
        taskLinks={taskLinks ?? new Map()}
        move={move}
      />

      <PlanningSessionDialog
        open={replanOpen}
        onOpenChange={setReplanOpen}
        clientId={year.clientId}
        clientName={year.clientName}
        template={template ?? null}
        existing={{
          yearId: year.id,
          startedOn: year.startedOn,
          openDays: year.openDays,
          // planning_answers is a raw jsonb column (Json); it was always
          // written from this exact shape (useCreateSchoolYear/useReplanSchoolYear),
          // so the cast just recovers the type the generated column type erases.
          answers: (year.planningAnswers ?? {
            applications_open_on: null,
            applications_close_on: null,
            open_days: [],
            offers_out_on: null,
            deposits_due_on: null,
            budget_set_month: null,
            grade_variations: "",
          }) as unknown as PlanningAnswers,
        }}
      />
    </div>
  );
}
