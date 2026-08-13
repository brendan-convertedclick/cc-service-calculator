// The procedure as it will exist in ClickUp: a run of tasks, each holding the
// steps that become its checklist.
//
// The two levels carry different things, and that split is the whole point:
//
//   Task  — name, department, owner, estimate. One ClickUp task. The only unit
//           that can change hands, so it is the only one with an owner.
//   Step  — number, title, verb, instructions, hours. One checklist item. It
//           belongs to whoever owns the task; a ClickUp checklist item has no
//           assignee anything can query, so offering one here would be a lie.
//
// Step numbers run straight through the procedure (1..N across every task)
// rather than restarting inside each one — see groupProcedure.

import {
  ChevronDown,
  ChevronUp,
  Copy,
  CornerLeftDown,
  CornerLeftUp,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SignalNoise, VerbSelect } from "@/components/systems/StepSignal";
import { groupProcedure, taskBlockedReason, taskHours } from "@/lib/procedure-shape";
import { pointsFromHours } from "@/types/placement-tasks";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

export type TaskListProps = {
  tasks: StepRow[];
  steps: StepRow[];
  depts: { id: string; name: string }[];
  team: { id: string; full_name: string }[];
  colorById: Map<string, string>;
  busy: boolean;
  /** Which steps have their signal/noise questions open. */
  signalOpen: Set<string>;
  onToggleSignal: (id: string) => void;
  onFocus: (id: string) => void;
  onAddTask: (after?: StepRow) => void;
  onAddStep: (task: StepRow, after?: StepRow) => void;
  onPatch: (row: StepRow, patch: StepUpdate, revert?: () => void) => void;
  onRename: (row: StepRow, raw: string, revert: () => void) => void;
  onHours: (row: StepRow, raw: string, revert: () => void) => void;
  onDuplicate: (row: StepRow) => void;
  onDelete: (row: StepRow) => void;
  onMove: (row: StepRow, siblings: StepRow[], direction: -1 | 1) => void;
  onPromote: (step: StepRow) => void;
  onFold: (task: StepRow, into: StepRow) => void;
};

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const ICON_BTN =
  "rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40";

export function TaskList(props: TaskListProps) {
  const { tasks, steps, depts, team, colorById, busy } = props;
  const groups = groupProcedure(tasks, steps);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  if (groups.length === 0) {
    return (
      <div className="space-y-3 px-5 pb-5">
        <p className="text-body-medium text-m-on-surface-variant">
          No tasks yet. A task is one ClickUp task — add the first one, then give it the steps that
          make up its checklist.
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => props.onAddTask()}>
          <Plus className="h-4 w-4" /> Add task
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-m-outline-variant">
      {groups.map((group, gi) => {
        const task = group.task;
        const owner = task.owner_id ? team.find((t) => t.id === task.owner_id) : null;
        const rows = group.steps.map((s) => s.step);
        const hours = taskHours(task, rows);
        const blocked = taskBlockedReason(task);
        const previous = gi > 0 ? groups[gi - 1].task : null;
        const pushes = task.materialise_as !== "none";

        return (
          <section
            key={task.id}
            className={cn(
              "border-b border-m-outline-variant",
              blocked && "bg-m-error-container/25",
            )}
          >
            {/* ── the task ─────────────────────────────────────────────── */}
            <div className="group/task flex items-center gap-2.5 px-5 py-3">
              <div className="flex flex-none flex-col">
                <button
                  type="button"
                  aria-label={`Move task "${task.title}" earlier`}
                  disabled={gi === 0 || busy}
                  onClick={() => props.onMove(task, tasks, -1)}
                  className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-25"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Move task "${task.title}" later`}
                  disabled={gi === groups.length - 1 || busy}
                  onClick={() => props.onMove(task, tasks, 1)}
                  className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-25"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: task.department_id ? "hsl(var(--mcolor-primary))" : "hsl(var(--mcolor-outline))" }}
                aria-hidden
              />

              {/* The name is the ClickUp task name. Not the department — that
                  is routing, and it sits beside the name as a chip. */}
              <input
                key={task.title}
                defaultValue={task.title}
                aria-label={`Task ${group.number} name`}
                title="Rename this task — this is the name that appears in ClickUp"
                placeholder="Name this task…"
                onFocus={() => props.onFocus(task.id)}
                onBlur={(e) => {
                  const el = e.target;
                  props.onRename(task, el.value, () => {
                    el.value = task.title;
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.currentTarget.value = task.title;
                    e.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-title-medium font-semibold text-m-on-surface outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
              />

              <select
                value={task.department_id ?? ""}
                aria-label={`Department for task "${task.title}"`}
                title={blocked ?? `${deptName.get(task.department_id ?? "") ?? ""} — sets the ClickUp Work Stream and list`}
                onChange={(e) => props.onPatch(task, { department_id: e.target.value || null })}
                className={cn(
                  "h-7 max-w-[12rem] flex-none rounded-md border bg-m-surface px-1.5 text-label-small",
                  blocked
                    ? "border-m-error text-m-error"
                    : "border-m-outline-variant text-m-on-surface",
                )}
              >
                <option value="">— pick a department</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              {gi > 0 && !blocked && (
                <span className="hidden flex-none font-mono text-label-small text-m-on-surface-variant lg:inline">
                  blocked by Task {gi}
                </span>
              )}
              {blocked && (
                <span className="flex-none font-mono text-label-small text-m-error">won&rsquo;t push</span>
              )}

              {/* Owner lives here, not on the steps: a checklist item cannot be
                  assigned to anyone ClickUp can find. */}
              <span className="relative inline-flex flex-none">
                {owner ? (
                  <span
                    className="grid h-7 w-7 place-items-center rounded-full text-label-small font-bold leading-none text-white"
                    style={{ background: colorById.get(owner.id) }}
                  >
                    {initials(owner.full_name)}
                  </span>
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-m-outline text-m-on-surface-variant">
                    <User className="h-3.5 w-3.5" />
                  </span>
                )}
                <select
                  value={task.owner_id ?? ""}
                  aria-label={`Owner of task "${task.title}"`}
                  title={owner ? `${owner.full_name} — click to change` : "Unassigned — click to set an owner"}
                  onChange={(e) => props.onPatch(task, { owner_id: e.target.value || null })}
                  className="absolute inset-0 cursor-pointer appearance-none rounded-full bg-transparent text-transparent opacity-0"
                >
                  <option value="">— unassigned</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </span>

              {/* With steps, the estimate is their sum and the DB keeps it that
                  way (process_steps_rollup_hours) — so it reads, it doesn't
                  edit. A task with no steps carries its own estimate. */}
              {rows.length > 0 ? (
                <span
                  className="flex-none font-mono text-label-small tabular-nums text-m-on-surface-variant"
                  title={`Sum of ${rows.length} step${rows.length === 1 ? "" : "s"}`}
                >
                  {hours == null ? "— h" : `${hours}h · ${pointsFromHours(hours)}pt`}
                </span>
              ) : (
                <input
                  key={String(task.estimated_hours)}
                  defaultValue={task.estimated_hours ?? ""}
                  type="number"
                  step="0.25"
                  min="0"
                  placeholder="— h"
                  aria-label={`Estimated hours for task "${task.title}"`}
                  onBlur={(e) => {
                    const el = e.target;
                    props.onHours(task, el.value, () => {
                      el.value = task.estimated_hours != null ? String(task.estimated_hours) : "";
                    });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  className="h-7 w-16 flex-none rounded-md border border-m-outline-variant bg-m-surface px-1.5 text-right font-mono text-label-small"
                />
              )}

              <span className="flex-none rounded-md bg-m-primary-container px-2 py-0.5 font-mono text-label-small text-m-on-primary-container">
                TASK {group.number}
              </span>

              <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/task:opacity-100">
                <Switch
                  checked={pushes}
                  aria-label={`Push task "${task.title}" to ClickUp`}
                  title={pushes ? "Creates a ClickUp task on push" : "Skipped on push — stays part of the written procedure"}
                  onCheckedChange={(on) => props.onPatch(task, { materialise_as: on ? "task" : "none" })}
                />
                <button
                  type="button"
                  aria-label={`Add a step to "${task.title}"`}
                  title="Add a step to this task"
                  disabled={busy}
                  onClick={() => props.onAddStep(task)}
                  className={ICON_BTN}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate task "${task.title}"`}
                  title="Duplicate this task and its steps"
                  disabled={busy}
                  onClick={() => props.onDuplicate(task)}
                  className={ICON_BTN}
                >
                  <Copy className="h-4 w-4" />
                </button>
                {previous && (
                  <button
                    type="button"
                    aria-label={`Fold "${task.title}" into "${previous.title}"`}
                    title={`Fold into "${previous.title}" — its steps join that task's checklist`}
                    disabled={busy}
                    onClick={() => props.onFold(task, previous)}
                    className={ICON_BTN}
                  >
                    <CornerLeftUp className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Delete task "${task.title}"`}
                  title="Delete this task"
                  onClick={() => props.onDelete(task)}
                  className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ── its steps ────────────────────────────────────────────── */}
            <ol className="pb-2 pl-12 pr-5">
              {group.steps.map(({ step, number }, si) => {
                const pushesStep = step.materialise_as !== "none";
                return (
                  <li
                    key={step.id}
                    className="group/step flex items-start gap-2 border-l border-m-outline-variant py-1 pl-3"
                  >
                    <span className="w-5 flex-none self-center pt-0.5 text-right font-mono text-label-medium tabular-nums text-m-on-surface-variant">
                      {number}
                    </span>
                    <div className="flex flex-none flex-col self-center">
                      <button
                        type="button"
                        aria-label={`Move step ${number} earlier`}
                        disabled={si === 0 || busy}
                        onClick={() => props.onMove(step, rows, -1)}
                        className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-20"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move step ${number} later`}
                        disabled={si === group.steps.length - 1 || busy}
                        onClick={() => props.onMove(step, rows, 1)}
                        className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-20"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-0.5">
                        <span className="relative inline-flex flex-none">
                          <span
                            className={cn(
                              "rounded-md px-1 py-0.5 text-body-medium hover:bg-m-surface-container-high",
                              step.verb ? "text-m-on-surface-variant" : "text-m-outline",
                            )}
                          >
                            [{step.verb ?? "verb"}]
                          </span>
                          <VerbSelect
                            value={step.verb}
                            label={`Verb for "${step.title}"`}
                            onChange={(verb) => props.onPatch(step, { verb })}
                            className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
                          />
                        </span>
                        <input
                          key={step.title}
                          defaultValue={step.title}
                          aria-label={`Step ${number} title`}
                          title="Rename this step — also centres its task on the canvas"
                          onFocus={() => props.onFocus(task.id)}
                          onBlur={(e) => {
                            const el = e.target;
                            props.onRename(step, el.value, () => {
                              el.value = step.title;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              e.currentTarget.value = step.title;
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-full truncate rounded-md bg-transparent px-1 py-0.5 text-body-large text-m-on-surface outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
                        />
                      </div>
                      {props.signalOpen.has(step.id) && (
                        <div className="pt-1">
                          <SignalNoise step={step} onPatch={(patch) => props.onPatch(step, patch)} />
                        </div>
                      )}
                    </div>

                    <input
                      key={String(step.estimated_hours)}
                      defaultValue={step.estimated_hours ?? ""}
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="—"
                      aria-label={`Estimated hours for step ${number}`}
                      title="Hours for this step — adds into its task's estimate"
                      onBlur={(e) => {
                        const el = e.target;
                        props.onHours(step, el.value, () => {
                          el.value = step.estimated_hours != null ? String(step.estimated_hours) : "";
                        });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      className="mt-0.5 h-7 w-14 flex-none rounded-md border border-m-outline-variant bg-m-surface px-1.5 text-right font-mono text-label-small"
                    />

                    <div className="mt-0.5 flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/step:opacity-100">
                      <Switch
                        checked={pushesStep}
                        aria-label={`Push step ${number} to ClickUp`}
                        title={pushesStep ? "Goes on the checklist" : "Skipped on push — stays part of the written procedure"}
                        onCheckedChange={(on) =>
                          props.onPatch(step, { materialise_as: on ? "checklist_item" : "none" })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Insert a step after step ${number}`}
                        title="Insert a step after this one"
                        disabled={busy}
                        onClick={() => props.onAddStep(task, step)}
                        className={ICON_BTN}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Duplicate step ${number}`}
                        title="Duplicate this step"
                        disabled={busy}
                        onClick={() => props.onDuplicate(step)}
                        className={ICON_BTN}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Promote step ${number} to its own task`}
                        title="Make this its own task — it gets an owner and a place in the hand-off chain"
                        disabled={busy}
                        onClick={() => props.onPromote(step)}
                        className={ICON_BTN}
                      >
                        <CornerLeftDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Signal or noise for step ${number}`}
                        title="Signal or noise — is this step worth keeping?"
                        onClick={() => props.onToggleSignal(step.id)}
                        className={ICON_BTN}
                      >
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", props.signalOpen.has(step.id) && "rotate-180")}
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete step ${number}`}
                        title="Delete this step"
                        onClick={() => props.onDelete(step)}
                        className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}

              <li className="pl-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => props.onAddStep(task)}
                  className="rounded-md px-1 py-1 font-mono text-label-small text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40"
                >
                  + Add step
                </button>
              </li>
            </ol>

            {/* Insert between tasks: a procedure gets written in the middle at
                least as often as at the end. */}
            <div className="group/ins flex h-6 items-center gap-2 px-5">
              <span className="h-px flex-1 bg-m-outline-variant opacity-0 transition-opacity group-hover/ins:opacity-100" />
              <button
                type="button"
                disabled={busy}
                onClick={() => props.onAddTask(task)}
                className="rounded-full bg-m-primary-container px-2.5 py-0.5 font-mono text-label-small text-m-on-primary-container opacity-0 transition-opacity hover:bg-m-primary hover:text-m-on-primary focus:opacity-100 group-hover/ins:opacity-100 disabled:opacity-40"
              >
                + insert task here
              </button>
              <span className="h-px flex-1 bg-m-outline-variant opacity-0 transition-opacity group-hover/ins:opacity-100" />
            </div>
          </section>
        );
      })}

      <div className="px-5 py-3">
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => props.onAddTask()}>
          <Plus className="h-4 w-4" /> Add task
        </Button>
      </div>
    </div>
  );
}
