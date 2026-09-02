// src/components/pipeline/SchoolDrawer.tsx
//
// The right-hand drawer opened from a school's card on /pipeline. One
// school, one year — everything here reads off useSchoolYear(yearId), so
// there is nothing to pass down but the id: the card that opened this drawer
// already agrees with what loads inside it because both read the same rows.
//
// The month panel has three registers, keyed off whether the picked month is
// before, at, or after the school's actual current month (0150's
// tg_school_tasks_guard is what makes "current" authoritative — this drawer
// only reads it): a past month is a closed record, the current month is the
// one thing with live checkboxes and due dates, a future month is a preview
// of what is coming. Only 'us' tasks ever get a checkbox here — a
// school-side task closes itself when their client_approvals row settles
// (0150 "Delta C"), never by a click in this drawer.

import { useEffect, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { toast } from "sonner";
import { AlertTriangle, Loader2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { currentMonthNo as computeCurrentMonthNo, monthProgress, type MonthLike } from "@/lib/pipeline-move";
import { sixWeekBreach } from "@/lib/pipeline-year";
import { initials } from "@/components/systems/SystemBlockNode";
import { memberColors, useTeam, type TeamMember } from "@/hooks/useTeam";
import { useServices } from "@/hooks/useServices";
import { useSetAccountOwner } from "@/hooks/usePipelineBoard";
import {
  useCloseMonth,
  useReopenMonth,
  useSchoolYear,
  useSetTaskHours,
  useToggleTaskDone,
  type SchoolYearTask,
} from "@/hooks/useSchoolYear";
import { YearComb } from "@/components/pipeline/YearComb";

function isLate(t: SchoolYearTask, today: string): boolean {
  return t.state !== "planned" && t.state !== "done" && t.due_date !== null && t.due_date < today;
}

export function SchoolDrawer({
  open,
  onOpenChange,
  yearId,
  initialMonth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  /** The NEXT button on the card lands here; omit to open on the school's current month. */
  initialMonth?: number | null;
}) {
  const { data: year, isLoading } = useSchoolYear(yearId);
  const { data: team } = useTeam();
  const { data: services } = useServices();
  const toggleDone = useToggleTaskDone();
  const closeMonth = useCloseMonth();
  const reopenMonth = useReopenMonth();

  const [selectedMonth, setSelectedMonth] = useState<number | null>(initialMonth ?? null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedMonth(initialMonth ?? null);
  }, [open, initialMonth, yearId]);

  const colorById = memberColors(team ?? []);
  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]));

  const current = year ? computeCurrentMonthNo(year.months as MonthLike[]) : null;
  const effectiveMonth = selectedMonth ?? current ?? 1;
  const month = year?.months.find((m) => m.month_no === effectiveMonth);
  const monthTasks = year ? year.tasks.filter((t) => t.month_no === effectiveMonth) : [];
  const attachedServiceIds = Array.from(new Set(monthTasks.filter((t) => t.service_id).map((t) => t.service_id as string)));
  const progress = year ? monthProgress(year.tasks, effectiveMonth) : { done: 0, total: 0 };
  // D7a: an emptied month (everything moved forward — close_school_year_month's
  // own remedy for "not yet done") is just as closeable as a fully-ticked one.
  // total === 0 must not block it; the RPC itself only refuses an undone task.
  const readyToClose =
    effectiveMonth === current && month && !month.closed_at && progress.done === progress.total;
  // D7b: only the most recently closed month may reopen (reopen_school_year_month's
  // own rule) — compute it so the button never offers a call that will fail.
  const maxClosedMonthNo = year
    ? year.months.reduce<number | null>(
        (max, m) => (m.closed_at && (max === null || m.month_no > max) ? m.month_no : max),
        null,
      )
    : null;
  const canReopen = !!month?.closed_at && month.month_no === maxClosedMonthNo;
  // The six-week rule is load-bearing (see the brief): fires only while the
  // gate task is still open and the open day is under six weeks out. Read
  // off the whole year, not the picked month, so it surfaces even when
  // someone is looking at a different month than the one at risk.
  const breach = year ? sixWeekBreach(year.openDays, year.months, year.tasks) : null;

  async function confirmCloseMonth() {
    if (!year || current === null) return;
    try {
      await closeMonth.mutateAsync({ yearId: year.id, monthNo: current });
      toast.success(current === 12 ? "Year complete." : `M${current} closed — M${current + 1} is now scheduled.`);
      setConfirmClose(false);
      setSelectedMonth(null); // follow the new current month rather than a now-closed one
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function confirmReopenMonth() {
    if (!year || !month) return;
    try {
      await reopenMonth.mutateAsync({ yearId: year.id, monthNo: month.month_no });
      toast.success(`M${month.month_no} reopened.`);
      setConfirmReopen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto motion-reduce:duration-0 sm:max-w-xl">
        <SheetTitle className="sr-only">{year ? `${year.clientName} — school year` : "School year"}</SheetTitle>

        {isLoading || !year ? (
          <div className="flex flex-1 items-center justify-center text-body-medium text-m-on-surface-variant">
            Loading…
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-headline-small text-m-on-surface">{year.clientName}</p>
                  {year.town ? <p className="text-body-small text-m-on-surface-variant">{year.town}</p> : null}
                </div>
                <OwnerPicker yearId={year.id} ownerId={year.accountOwnerId} team={team ?? []} colorById={colorById} />
              </div>

              <YearComb
                months={year.months}
                currentMonthNo={current}
                selectedMonthNo={effectiveMonth}
                onSelectMonth={setSelectedMonth}
                size="lg"
              />
            </SheetHeader>

            {breach ? (
              <div className="flex items-start gap-2 rounded-lg border border-m-error bg-m-error-container px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-m-on-error-container" aria-hidden />
                <p className="text-label-medium text-m-on-error-container">
                  {breach.passed
                    ? `M${breach.month_no}'s open day was ${breach.days} day(s) ago and creative was never approved — the run-up is gone.`
                    : `M${breach.month_no}'s open day is ${breach.days} day(s) away and creative still isn't approved — under the six-week minimum run-up.`}
                </p>
              </div>
            ) : null}

            {month ? (
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-label-small text-m-on-surface-variant">M{month.month_no}</p>
                    <p className="text-title-medium text-m-on-surface">{month.theme}</p>
                  </div>
                  {month.closed_at ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="success">Closed</Badge>
                      {canReopen ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirmReopen(true)}>
                          Reopen M{month.month_no}
                        </Button>
                      ) : null}
                    </div>
                  ) : month.month_no === current ? (
                    <Badge>
                      {progress.done}/{progress.total} done
                    </Badge>
                  ) : (
                    <Badge variant="muted">Not started</Badge>
                  )}
                </div>

                {month.month_no > (current ?? 0) && !month.closed_at ? (
                  <p className="text-body-small text-m-on-surface-variant">
                    Not started yet — this is what {year.clientName} will need to clear when this month arrives.
                  </p>
                ) : null}

                {readyToClose ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-m-primary bg-m-primary-container px-3 py-2">
                    <p className="text-label-medium text-m-on-primary-container">
                      {progress.total === 0 ? `Nothing left in M${month.month_no}.` : `Everything in M${month.month_no} is done.`}
                    </p>
                    <Button size="sm" onClick={() => setConfirmClose(true)}>
                      Close M{month.month_no}
                    </Button>
                  </div>
                ) : null}

                {attachedServiceIds.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-label-small text-m-on-surface-variant">Services:</span>
                    {attachedServiceIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {serviceNameById.get(id) ?? "Unknown service"}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <TaskGroup title="Ours" tasks={monthTasks.filter((t) => t.side === "us")} month={month} current={current} toggleDone={toggleDone} yearId={year.id} />
                <TaskGroup title="Theirs" tasks={monthTasks.filter((t) => t.side === "school")} month={month} current={current} toggleDone={toggleDone} yearId={year.id} />
              </div>
            ) : null}
          </>
        )}
      </SheetContent>

      {year && current !== null ? (
        <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Close M{current}{current < 12 ? ` and move to M${current + 1}?` : " — end the year?"}
              </DialogTitle>
              <DialogDescription>
                {current < 12
                  ? `Locks M${current} and schedules M${current + 1}'s tasks with real due dates.`
                  : "This is the last month — closing it ends the year and books the next planning session."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmClose(false)} disabled={closeMonth.isPending}>
                Not yet
              </Button>
              <Button onClick={() => void confirmCloseMonth()} disabled={closeMonth.isPending}>
                {closeMonth.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Close M{current}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {year && month?.closed_at ? (
        <Dialog open={confirmReopen} onOpenChange={setConfirmReopen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Reopen M{month.month_no}?</DialogTitle>
              <DialogDescription>
                Its tasks come back on the board and the month is no longer closed. Only the most recently closed
                month can reopen.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmReopen(false)} disabled={reopenMonth.isPending}>
                Not yet
              </Button>
              <Button onClick={() => void confirmReopenMonth()} disabled={reopenMonth.isPending}>
                {reopenMonth.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Reopen M{month.month_no}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Sheet>
  );
}

function TaskGroup({
  title,
  tasks,
  month,
  current,
  toggleDone,
  yearId,
}: {
  title: string;
  tasks: SchoolYearTask[];
  month: { month_no: number; closed_at: string | null };
  current: number | null;
  toggleDone: ReturnType<typeof useToggleTaskDone>;
  yearId: string;
}) {
  const setHours = useSetTaskHours();
  if (tasks.length === 0) return null;
  const today = todayISO();
  const isPast = month.closed_at !== null;
  const isCurrent = month.month_no === current;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label-small font-medium uppercase tracking-wide text-m-on-surface-variant">{title}</p>
      {tasks.map((t) => {
        const late = isLate(t, today);
        const canTick = title === "Ours" && isCurrent && !isPast;
        return (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5",
              late ? "bg-m-error-container/40" : "bg-m-surface-container",
            )}
          >
            {canTick ? (
              <Checkbox
                checked={t.state === "done"}
                disabled={toggleDone.isPending}
                onCheckedChange={(checked) =>
                  toggleDone.mutate(
                    { yearId, taskId: t.id, done: checked === true },
                    { onError: (e) => toast.error(errorMessage(e)) },
                  )
                }
                className="mt-0.5"
                aria-label={t.label}
              />
            ) : (
              <span
                className={cn(
                  "mt-1 h-3.5 w-3.5 flex-none rounded-full border",
                  t.state === "done" ? "border-m-primary bg-m-primary" : "border-m-outline-variant",
                )}
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn("text-label-medium text-m-on-surface", t.state === "done" && "text-m-on-surface-variant line-through")}>
                {t.label}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.due_date ? (
                  <span className={cn("text-label-small tabular-nums", late ? "text-m-error" : "text-m-on-surface-variant")}>
                    Due {t.due_date}
                  </span>
                ) : null}
                {title === "Theirs" && t.state !== "done" ? <Badge variant="warning">Waiting on them</Badge> : null}
                {t.assigneeName ? <span className="text-label-small text-m-on-surface-variant">· {t.assigneeName}</span> : null}
              </div>
            </div>
            {/* D2: the one place a task's estimate is editable — not the
                planner card, which is the drag pick-up target. */}
            <input
              key={String(t.est_hours)}
              defaultValue={t.est_hours ?? ""}
              type="number"
              step="0.25"
              min="0"
              disabled={isPast || t.state === "done"}
              placeholder="— h"
              aria-label={`Estimated hours for "${t.label}"`}
              onBlur={(e) => {
                const el = e.target;
                const raw = el.value.trim();
                const parsed = raw === "" ? null : Number(raw);
                if (raw !== "" && (parsed === null || Number.isNaN(parsed))) {
                  el.value = t.est_hours != null ? String(t.est_hours) : "";
                  return;
                }
                if (parsed === t.est_hours) return;
                setHours.mutate(
                  { yearId, taskId: t.id, hours: parsed },
                  { onError: (e2) => {
                      toast.error(errorMessage(e2));
                      el.value = t.est_hours != null ? String(t.est_hours) : "";
                    } },
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="mt-0.5 h-7 w-14 flex-none rounded-md border border-m-outline-variant bg-m-surface px-1.5 text-right font-mono text-label-small disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        );
      })}
    </div>
  );
}

const NONE = "__none__";

function OwnerPicker({
  yearId,
  ownerId,
  team,
  colorById,
}: {
  yearId: string;
  ownerId: string | null;
  team: TeamMember[];
  colorById: Map<string, string>;
}) {
  const setOwner = useSetAccountOwner();
  const owner = ownerId ? team.find((t) => t.id === ownerId) : undefined;

  return (
    <Select
      value={ownerId ?? NONE}
      onValueChange={(v) =>
        setOwner.mutate(
          { yearId, memberId: v === NONE ? null : v },
          { onError: (e) => toast.error(errorMessage(e)) },
        )
      }
    >
      {/* The primitive, not our SelectTrigger — that one hard-codes a
          full-width field, which fights a 36px avatar circle. */}
      <SelectPrimitive.Trigger
        aria-label={owner ? `Account owner: ${owner.full_name}` : "Set an account owner"}
        title={owner?.full_name ?? "No account owner set"}
        className={cn(
          "grid h-9 w-9 flex-none place-items-center rounded-full text-label-small font-bold leading-none",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          owner ? "text-white" : "border border-dashed border-m-outline text-m-on-surface-variant",
        )}
        style={owner ? { background: colorById.get(owner.id) } : undefined}
      >
        {owner ? initials(owner.full_name) : <User className="h-4 w-4" />}
      </SelectPrimitive.Trigger>
      <SelectContent>
        <SelectItem value={NONE}>— no account owner</SelectItem>
        {team.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
