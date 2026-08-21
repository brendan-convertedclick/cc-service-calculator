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

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { DocLinksField } from "@/components/systems/DocLinksField";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  CornerLeftDown,
  CornerLeftUp,
  Link2,
  Mail,
  Plus,
  Settings,
  StickyNote,
  ToggleLeft,
  ToggleRight,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VerbSelect } from "@/components/systems/VerbSelect";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useUpdateStep } from "@/hooks/useProcessSteps";
import { useStepNotes } from "@/hooks/useStepNotes";
import { useSystemDefinitions } from "@/hooks/useSystemDefinitions";
import {
  useAttachProcedure,
  useDetachProcedure,
  useStepProcedures,
} from "@/hooks/useStepProcedures";
import { groupProcedure, taskBlockedReason, taskHours } from "@/lib/procedure-shape";
import { pointsFromHours } from "@/types/placement-tasks";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";
import type { Database } from "@/types/db";

type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

export type TaskListProps = {
  systemId: string;
  tasks: StepRow[];
  steps: StepRow[];
  depts: { id: string; name: string }[];
  team: { id: string; full_name: string }[];
  colorById: Map<string, string>;
  busy: boolean;
  onFocus: (id: string) => void;
  onAddTask: (after?: StepRow) => void;
  onAddStep: (task: StepRow, after?: StepRow) => void;
  onPatch: (row: StepRow, patch: StepUpdate, revert?: () => void) => void;
  onRename: (row: StepRow, raw: string, revert: () => void) => void;
  onHours: (row: StepRow, raw: string, revert: () => void) => void;
  /** Point the page's notes panel at this row (and slide it in if it's out). */
  onOpenNotes: (rowId: string) => void;
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
  "relative rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40";

// How many notes on this row are still open. Silent when there are none —
// a zero would make every row look annotated.
function NoteCount({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-m-primary px-0.5 font-mono text-[9px] leading-none text-m-on-primary">
      {n}
    </span>
  );
}

/** Everything a row can do except duplicate and delete, behind one cog.
 *  Eight icons in a row do not survive a narrow window — the task row already
 *  carries a name, a department, an owner and an estimate before any of them
 *  appear. The open-note count rides on the trigger so a row with something to
 *  read still says so without the menu being open. */
function RowMenu({ label, notes, children }: { label: string; notes?: number; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={ICON_BTN}>
          <Settings className="h-4 w-4" />
          <NoteCount n={notes} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// Titles are edited in place, so the editor IS the label — and an <input>
// cannot wrap, which is why long step names were cut off mid-sentence. A
// textarea wraps; this keeps it exactly as tall as its content so it still
// reads as a line of text rather than a form field.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** What a row points at: the procedures it hands off to, and the email it
 *  sends. Both write immediately rather than staging into the pane's draft —
 *  a picker that appears to do nothing until Save is the trap that has already
 *  caught people twice, and procedure attachments live in their own table with
 *  no draft to stage into anyway.
 *
 *  These replace what used to be typed into the title as [Procedure] and
 *  [Template]: a title goes to ClickUp verbatim, so markers typed there ship
 *  as literal text. */
function StepLinks({
  row,
  systemId,
  showDocs = false,
}: {
  row: StepRow;
  systemId: string;
  /** Task rows only. A checklist item has nowhere to put a link in ClickUp,
   *  so offering the field on a step would promise what the push can't keep. */
  showDocs?: boolean;
}) {
  const { data: attachedByStep } = useStepProcedures(systemId);
  const { data: templates = [] } = useEmailTemplates();
  const { data: systems = [] } = useSystemDefinitions();
  const attach = useAttachProcedure();
  const detach = useDetachProcedure();
  const update = useUpdateStep();

  const attached = attachedByStep?.get(row.id) ?? [];
  const template = templates.find((t) => t.id === row.email_template_id) ?? null;
  // Never offer this row's own system: a procedure that runs itself is a loop,
  // and the one thing a pointer must not do is point home.
  const options = systems.filter((sys) => sys.id !== systemId && !attached.some((a) => a.system_id === sys.id));

  function setTemplate(id: string | null) {
    update.mutate(
      { id: row.id, patch: { email_template_id: id } },
      { onError: (e) => toast.error(`Could not link the template: ${errorMessage(e)}`) }
    );
  }

  return (
    <div className="space-y-1.5 pt-1">
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 rounded-md bg-m-secondary-container px-2 py-0.5 text-label-small text-m-on-secondary-container"
        >
          <Link2 className="h-3 w-3" />
          <a href={`/systems/${a.system_id}`} className="hover:underline">{a.name}</a>
          <button
            type="button"
            aria-label={`Unlink "${a.name}"`}
            title="Unlink"
            onClick={() => detach.mutate(a.id)}
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}

      {template && (
        <span className="inline-flex items-center gap-1 rounded-md bg-m-tertiary-container px-2 py-0.5 text-label-small text-m-on-tertiary-container">
          <Mail className="h-3 w-3" />
          {template.name}
          <a
            href={`/comms/new?template=${encodeURIComponent(template.slug)}`}
            title={`Open a new email from the "${template.name}" template`}
            className="rounded px-1 font-medium underline decoration-dotted underline-offset-2 hover:bg-m-tertiary-container hover:opacity-100"
          >
            Draft
          </a>
          <button
            type="button"
            aria-label={`Unlink template "${template.name}"`}
            title="Unlink"
            onClick={() => setTemplate(null)}
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </span>
      )}

      <select
        value=""
        aria-label={`Link a procedure to "${row.title}"`}
        title="Link the procedure this step hands off to"
        disabled={attach.isPending}
        onChange={(e) => {
          if (!e.target.value) return;
          attach.mutate(
            { stepId: row.id, systemId: e.target.value },
            { onError: (err) => toast.error(`Could not link: ${errorMessage(err)}`) }
          );
          e.target.value = "";
        }}
        className="h-6 max-w-[10rem] rounded-md border border-dashed border-m-outline-variant bg-transparent px-1 text-label-small text-m-on-surface-variant"
      >
        <option value="">+ procedure</option>
        {options.map((sys) => (
          <option key={sys.id} value={sys.id}>{sys.name}</option>
        ))}
      </select>

      {!template && (
        <select
          value=""
          aria-label={`Link an email template to "${row.title}"`}
          title="Link the email this step sends"
          onChange={(e) => e.target.value && setTemplate(e.target.value)}
          className="h-6 max-w-[10rem] rounded-md border border-dashed border-m-outline-variant bg-transparent px-1 text-label-small text-m-on-surface-variant"
        >
          <option value="">+ email template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}
    </div>

      {showDocs && (
        <DocLinksField
          links={row.doc_links ?? []}
          pending={update.isPending}
          onWrite={(next) =>
            update.mutate(
              { id: row.id, patch: { doc_links: next } },
              { onError: (e) => toast.error(`Could not save the documents: ${errorMessage(e)}`) },
            )
          }
          noun="task"
        />
      )}
    </div>
  );
}

export function TaskList(props: TaskListProps) {
  // Notes live in the docked panel on the right, not inline: one row's note is
  // a conversation (who, when, dealt with or not), which is more than a line
  // under the title can hold. The panel is owned by the page — it sits beside
  // the whole editor — so a row only asks for it to point at itself.
  const { data: notes = [] } = useStepNotes(props.systemId);
  const openNotes = new Map<string, number>();
  for (const n of notes) {
    if (n.done_at) continue;
    openNotes.set(n.step_id, (openNotes.get(n.step_id) ?? 0) + 1);
  }
  // Same rule for links: a row that already points somewhere always shows it,
  // otherwise the chain is invisible until you happen to click the icon.
  const [linkOpen, setLinkOpen] = useState<Set<string>>(new Set());
  const toggleLink = (id: string) => setLinkOpen((prev) => toggleInSet(prev, id));
  const { data: attachedByStep } = useStepProcedures(props.systemId);
  const linksShown = (row: StepRow) =>
    linkOpen.has(row.id)
    || row.email_template_id != null
    || (row.doc_links?.length ?? 0) > 0
    || (attachedByStep?.get(row.id)?.length ?? 0) > 0;
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

              {/* Its place in the run, in front of the name it belongs to — the
                  same position the steps number from. It used to sit far right
                  as a "TASK 3" chip, which is the first thing a narrow window
                  pushed off the end. */}
              <span className="w-5 flex-none text-right font-mono text-label-large tabular-nums text-m-on-surface-variant">
                {group.number}
              </span>

              {/* The name is the ClickUp task name. Not the department — that
                  is routing, and it sits beside the name as a chip. */}
              <textarea
                key={task.title}
                ref={autoGrow}
                rows={1}
                defaultValue={task.title}
                aria-label={`Task ${group.number} name`}
                title="Rename this task — this is the name that appears in ClickUp"
                placeholder="Name this task…"
                onFocus={() => props.onFocus(task.id)}
                onInput={(e) => autoGrow(e.currentTarget)}
                onBlur={(e) => {
                  const el = e.target;
                  props.onRename(task, el.value, () => {
                    el.value = task.title;
                    autoGrow(el);
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Enter commits the rename; it never puts a newline into a
                    // ClickUp task name.
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    e.currentTarget.value = task.title;
                    autoGrow(e.currentTarget);
                    e.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 resize-none overflow-hidden rounded-md bg-transparent px-1 py-0.5 text-title-medium font-semibold leading-snug text-m-on-surface outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
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

              {/* The blocked-by chain is not spelled out here any more: it is
                  always the task above, so the row said the obvious and was the
                  first thing to wrap on a narrow window. The canvas draws it. */}
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

              {/* The only estimate in the procedure. Steps are the how, not the
                  how long — a task is what ClickUp gets and what gets quoted,
                  so it carries the number and the points it works out to. */}
              <span className="flex flex-none items-center gap-1.5">
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
                <span className="w-10 flex-none font-mono text-label-small tabular-nums text-m-on-surface-variant">
                  {hours == null ? "" : `${pointsFromHours(hours)}pt`}
                </span>
              </span>

              <div className="flex flex-none items-center gap-0.5">
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/task:opacity-100">
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
                <RowMenu label={`Options for task "${task.title}"`} notes={openNotes.get(task.id)}>
                  <MenuItem icon={Plus} label="Add a step" disabled={busy} onClick={() => props.onAddStep(task)} />
                  <MenuItem icon={Link2} label="Links and documents" onClick={() => toggleLink(task.id)} />
                  <MenuItem icon={StickyNote} label="Notes" onClick={() => props.onOpenNotes(task.id)} />
                  {previous && (
                    <MenuItem
                      icon={CornerLeftUp}
                      label={`Fold into "${previous.title}"`}
                      disabled={busy}
                      onClick={() => props.onFold(task, previous)}
                    />
                  )}
                  {/* This was a Switch in the row; as a menu line it has to say
                      which way it is pointing, so the label is the state and
                      the click is the flip. */}
                  <MenuItem
                    icon={pushes ? ToggleRight : ToggleLeft}
                    label={pushes ? "Creates a ClickUp task" : "Skipped on push"}
                    onClick={() => props.onPatch(task, { materialise_as: pushes ? "none" : "task" })}
                  />
                </RowMenu>
              </div>
            </div>

            {linksShown(task) && (
              <div className="border-t border-m-outline-variant bg-m-surface-container-low px-5 pb-2">
                <StepLinks row={task} systemId={props.systemId} showDocs />
              </div>
            )}

            {/* ── its steps ────────────────────────────────────────────── */}
            <ol className="pb-2 pl-12 pr-5">
              {group.steps.map(({ step, number }, si) => {
                const pushesStep = step.materialise_as !== "none";
                return (
                  <li
                    key={step.id}
                    className="group/step flex items-start gap-2 border-l border-m-outline-variant py-1 pl-3"
                  >
                    <span className="w-5 flex-none pt-1 text-right font-mono text-label-medium tabular-nums text-m-on-surface-variant">
                      {number}
                    </span>
                    <div className="flex flex-none flex-col pt-0.5">
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
                      <div className="flex items-start gap-0.5">
                        <span className="relative inline-flex flex-none">
                          <span
                            className={cn(
                              "block rounded-md px-1 py-0.5 text-label-medium leading-snug hover:bg-m-surface-container-high",
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
                        <textarea
                          key={step.title}
                          ref={autoGrow}
                          rows={1}
                          defaultValue={step.title}
                          aria-label={`Step ${number} title`}
                          title="Rename this step — also centres its task on the canvas"
                          onFocus={() => props.onFocus(task.id)}
                          onInput={(e) => autoGrow(e.currentTarget)}
                          onBlur={(e) => {
                            const el = e.target;
                            props.onRename(step, el.value, () => {
                              el.value = step.title;
                              autoGrow(el);
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                            if (e.key === "Escape") {
                              e.currentTarget.value = step.title;
                              autoGrow(e.currentTarget);
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-full resize-none overflow-hidden rounded-md bg-transparent px-1 py-0.5 text-body-medium leading-snug text-m-on-surface outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
                        />
                      </div>
                      {linksShown(step) && <StepLinks row={step} systemId={props.systemId} />}
                    </div>

                    <div className="mt-0.5 flex flex-none items-center gap-0.5">
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/step:opacity-100">
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
                          aria-label={`Delete step ${number}`}
                          title="Delete this step"
                          onClick={() => props.onDelete(step)}
                          className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <RowMenu label={`Options for step ${number}`} notes={openNotes.get(step.id)}>
                        <MenuItem
                          icon={Plus}
                          label="Insert a step after this"
                          disabled={busy}
                          onClick={() => props.onAddStep(task, step)}
                        />
                        <MenuItem icon={Link2} label="Links" onClick={() => toggleLink(step.id)} />
                        <MenuItem icon={StickyNote} label="Notes" onClick={() => props.onOpenNotes(step.id)} />
                        <MenuItem
                          icon={CornerLeftDown}
                          label="Make it its own task"
                          disabled={busy}
                          onClick={() => props.onPromote(step)}
                        />
                        <MenuItem
                          icon={pushesStep ? ToggleRight : ToggleLeft}
                          label={pushesStep ? "Goes on the checklist" : "Skipped on push"}
                          onClick={() =>
                            props.onPatch(step, { materialise_as: pushesStep ? "none" : "checklist_item" })
                          }
                        />
                      </RowMenu>
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
