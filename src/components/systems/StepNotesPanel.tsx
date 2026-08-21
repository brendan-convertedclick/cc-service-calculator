// The notes panel: every note left on this procedure, in one column, plus the
// form to leave another.
//
// Notes used to be one textarea per row, inline in the list. That gave a
// procedure one anonymous, undated line per step — fine for "the login is in
// 1Password", useless for "Sarah says the client changed the template on
// 3 March". Here every note carries who wrote it, who has to do something
// about it, and a date.
//
// The list is the whole procedure's notes, not the selected row's: opening the
// panel on a row that happens to have none used to read as "this procedure has
// no notes" while five sat on the row above. The row picker still chooses
// where a *new* note lands, and each note is filed under the row it is about.
//
// Docked, not a dialog: a Sheet lays an overlay over the page, and reading a
// note while editing the task it is about is the whole point. This is a column
// beside the editor — open it and the editor narrows, both stay usable.
import { useEffect, useState } from "react";
import { Check, Pencil, PanelRightClose, Plus, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUserId } from "@/context/AuthContext";
import {
  useAddStepNote,
  useDeleteStepNote,
  useStepNotes,
  useToggleStepNote,
  useUpdateStepNote,
  type StepNote,
} from "@/hooks/useStepNotes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { memberColors } from "@/hooks/useTeam";
import { initials } from "@/components/systems/SystemBlockNode";
import { groupProcedure } from "@/lib/procedure-shape";
import { cn, errorMessage } from "@/lib/utils";
import type { Database } from "@/types/db";

type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];
type TeamRow = { id: string; full_name: string };

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface";
const ICON_BUTTON_CLASS =
  "grid h-8 w-8 flex-none place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40";

export function StepNotesPanel({
  systemId,
  tasks,
  steps,
  team,
  onClose,
  rowId,
  onSelectRow,
  onPatch,
}: {
  systemId: string;
  tasks: StepRow[];
  steps: StepRow[];
  team: TeamRow[];
  onClose: () => void;
  /** The row the panel is pointed at — set by whichever row was clicked. */
  rowId: string | null;
  onSelectRow: (id: string) => void;
  onPatch: (row: StepRow, patch: StepUpdate) => void;
}) {
  const currentUserId = useCurrentUserId();
  const { data: notes = [] } = useStepNotes(systemId);
  const add = useAddStepNote(systemId);
  const toggle = useToggleStepNote();
  const update = useUpdateStepNote();
  const remove = useDeleteStepNote();
  const [body, setBody] = useState("");
  // A new note defaults to whoever is filing it: most notes are your own
  // to-do, and the handover case is one dropdown away.
  const [assignee, setAssignee] = useState<string>(currentUserId ?? "");
  const teamById = new Map(team.map((t) => [t.id, t]));
  // Same palette as the canvas and the task list — one person, one colour
  // everywhere they appear.
  const colorById = memberColors(team);

  const groups = groupProcedure(tasks, steps);
  const row = [...tasks, ...steps].find((r) => r.id === rowId) ?? null;

  // Every row in the order the procedure runs, so the notes below read down
  // the page the same way the task list does.
  const rowsInOrder: { id: string; label: string }[] = groups.flatMap((g) => [
    { id: g.task.id, label: `Task ${g.number} · ${g.task.title}` },
    ...g.steps.map(({ step, number }) => ({ id: step.id, label: `${number}. ${step.title}` })),
  ]);
  const byRow = new Map<string, StepNote[]>();
  for (const n of notes) byRow.set(n.step_id, [...(byRow.get(n.step_id) ?? []), n]);

  // A note typed against one row must not follow you to the next one.
  useEffect(() => setBody(""), [rowId]);

  function submit() {
    const trimmed = body.trim();
    if (!trimmed || !rowId) return;
    add.mutate(
      { stepId: rowId, body: trimmed, authorId: currentUserId, assignedTo: assignee || null },
      {
        onSuccess: () => setBody(""),
        onError: (e) => toast.error(`Could not save that note: ${errorMessage(e)}`),
      }
    );
  }

  return (
    <aside className="flex w-[22rem] flex-none flex-col overflow-y-auto border-l border-m-outline-variant bg-m-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-title-medium text-m-on-surface">Notes</h2>
        <button type="button" className={ICON_BUTTON_CLASS} onClick={onClose} title="Slide the notes out" aria-label="Close notes">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Which row the note lands on. Opening from a row preselects it; the
          picker is here so you can move down the procedure without closing
          the panel and hunting for the next sticky-note icon. */}
      <select
        value={rowId ?? ""}
        aria-label="Task or step this note is about"
        onChange={(e) => onSelectRow(e.target.value)}
        className={cn(SELECT_CLASS, "mt-4")}
      >
        {groups.map((g) => (
          <optgroup key={g.task.id} label={`Task ${g.number} · ${g.task.title}`}>
            <option value={g.task.id}>The task itself</option>
            {g.steps.map(({ step, number }) => (
              <option key={step.id} value={step.id}>
                {number}. {step.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {row && (
        <>
          {/* The row's own description stays here rather than in the list:
              it is procedure content — the canvas renders it and the ClickUp
              push carries it — so it isn't a note and shouldn't read as one. */}
          <label className="mt-4 block text-label-small font-medium text-m-on-surface-variant">
            Description — shows on the canvas and in ClickUp
            <textarea
              key={row.id}
              defaultValue={row.description ?? ""}
              rows={2}
              placeholder="What the title doesn't say…"
              onBlur={(e) => onPatch(row, { description: e.target.value.trim() || null })}
              className="mt-1 w-full resize-y rounded-md border border-m-outline-variant bg-m-surface-container-low px-2 py-1.5 text-body-small font-normal leading-snug text-m-on-surface outline-none focus:border-m-primary focus:bg-m-surface"
            />
          </label>

          <div className="mt-4 space-y-2">
            <textarea
              value={body}
              rows={3}
              placeholder={`Note about "${row.title}"…`}
              aria-label="New note"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              className="w-full resize-y rounded-md border border-m-outline-variant bg-m-surface px-2 py-1.5 text-body-small leading-snug text-m-on-surface outline-none focus:border-m-primary"
            />
            <div className="flex items-center gap-2">
              <AssigneeSelect value={assignee} team={team} colorById={colorById} onChange={setAssignee} />
              <button
                type="button"
                className={cn(ICON_BUTTON_CLASS, "bg-m-primary text-m-on-primary hover:bg-m-primary hover:text-m-on-primary")}
                title="Add note (⌘↵)"
                aria-label="Add note"
                disabled={!body.trim() || add.isPending}
                onClick={submit}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      <div className="mt-5 space-y-4 border-t border-m-outline-variant pt-4 pb-6">
        {notes.length === 0 && (
          <p className="text-body-small text-m-on-surface-variant">No notes on this procedure yet.</p>
        )}
        {rowsInOrder.map(({ id, label }) => {
          const rowNotes = byRow.get(id) ?? [];
          if (rowNotes.length === 0) return null;
          return (
            <section key={id} className="space-y-2">
              <button
                type="button"
                onClick={() => onSelectRow(id)}
                title="Point the form at this one"
                className={cn(
                  "block w-full truncate text-left text-label-small font-medium",
                  id === rowId ? "text-m-primary" : "text-m-on-surface-variant hover:text-m-on-surface"
                )}
              >
                {label}
              </button>
              {rowNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  team={team}
                  teamById={teamById}
                  colorById={colorById}
                  busy={toggle.isPending || remove.isPending || update.isPending}
                  onToggle={(done) =>
                    toggle.mutate(
                      { id: note.id, done, byId: currentUserId },
                      { onError: (e) => toast.error(`Could not update that note: ${errorMessage(e)}`) }
                    )
                  }
                  onSave={(patch, done) =>
                    update.mutate(
                      { id: note.id, patch },
                      {
                        onSuccess: done,
                        onError: (e) => toast.error(`Could not save that note: ${errorMessage(e)}`),
                      }
                    )
                  }
                  onDelete={() =>
                    remove.mutate(note.id, {
                      onError: (e) => toast.error(`Could not delete that note: ${errorMessage(e)}`),
                    })
                  }
                />
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

/** Who a note is for — the same circle the note itself shows, in the list and
 *  on the trigger, so picking a person and reading one back look alike. Radix
 *  rather than a native <select>: an <option> cannot hold a coloured avatar.
 *  Unassigned needs a sentinel value because Radix reserves "". */
const UNASSIGNED = "unassigned";

function AssigneeSelect({
  value,
  team,
  colorById,
  onChange,
}: {
  value: string;
  team: TeamRow[];
  colorById: Map<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || UNASSIGNED} onValueChange={(v) => onChange(v === UNASSIGNED ? "" : v)}>
      <SelectTrigger aria-label="Who the note is for" className="h-9 min-w-0 flex-1 px-2 text-body-small">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>
          <span className="flex items-center gap-2">
            <Avatar colorById={colorById} />
            Unassigned
          </span>
        </SelectItem>
        {team.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            <span className="flex items-center gap-2">
              <Avatar person={t} colorById={colorById} />
              {t.full_name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A person as a coloured circle of initials — the same one the canvas and the
 *  task list draw. No person is a dashed outline: unassigned, not nobody. */
function Avatar({ person, colorById }: { person?: TeamRow; colorById: Map<string, string> }) {
  if (!person) {
    return (
      <span
        title="Unassigned"
        className="grid h-5 w-5 flex-none place-items-center rounded-full border border-dashed border-m-outline text-m-on-surface-variant"
      >
        <User className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      title={`For ${person.full_name}`}
      className="grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] font-bold leading-none text-white"
      style={{ background: colorById.get(person.id) }}
    >
      {initials(person.full_name)}
    </span>
  );
}

function NoteCard({
  note,
  team,
  teamById,
  colorById,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  note: StepNote;
  team: TeamRow[];
  teamById: Map<string, TeamRow>;
  colorById: Map<string, string>;
  busy: boolean;
  onToggle: (done: boolean) => void;
  onSave: (patch: { body?: string; assigned_to?: string | null }, done: () => void) => void;
  onDelete: () => void;
}) {
  const done = note.done_at != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [assignee, setAssignee] = useState(note.assigned_to ?? "");
  // The shared team@ login has no team_members row, so a real note can still
  // have no author — say so rather than leave the line unattributed.
  const who = (id: string | null) => (id ? teamById.get(id)?.full_name ?? "Someone" : "Someone");
  const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

  function startEdit() {
    setDraft(note.body);
    setAssignee(note.assigned_to ?? "");
    setEditing(true);
  }

  function save() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave({ body: trimmed, assigned_to: assignee || null }, () => setEditing(false));
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        done ? "border-m-outline-variant bg-m-surface-container-low" : "border-m-outline-variant bg-m-surface"
      )}
    >
      {editing ? (
        <div className="space-y-2">
          <p className="text-label-small text-m-on-surface-variant">
            Logged by {who(note.created_by)} · {when(note.created_at)}
            {done && note.done_at && ` · done by ${who(note.done_by)} ${when(note.done_at)}`}
          </p>
          <textarea
            value={draft}
            rows={3}
            aria-label="Edit note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full resize-y rounded-md border border-m-outline-variant bg-m-surface px-2 py-1.5 text-body-small leading-snug text-m-on-surface outline-none focus:border-m-primary"
          />
          <div className="flex items-center gap-2">
            <AssigneeSelect value={assignee} team={team} colorById={colorById} onChange={setAssignee} />
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              title="Save"
              aria-label="Save note"
              disabled={busy || !draft.trim()}
              onClick={save}
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              title="Cancel"
              aria-label="Cancel editing"
              onClick={() => setEditing(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label={done ? "Mark this note as not done" : "Mark this note as done"}
              title={done ? "Reopen" : "Mark done"}
              disabled={busy}
              onClick={() => onToggle(!done)}
              className={cn(
                "mt-0.5 grid h-5 w-5 flex-none place-items-center rounded border",
                done ? "border-m-primary bg-m-primary text-m-on-primary" : "border-m-outline text-transparent"
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <p
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap text-body-small leading-snug",
                done ? "text-m-on-surface-variant line-through decoration-1" : "text-m-on-surface"
              )}
            >
              {note.body}
            </p>
            <button
              type="button"
              aria-label="Edit this note"
              title="Edit"
              disabled={busy}
              onClick={startEdit}
              className="mt-0.5 flex-none rounded p-1 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete this note"
              title="Delete"
              disabled={busy}
              onClick={onDelete}
              className="mt-0.5 flex-none rounded p-1 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Who it's for as a circle, not a name: the column is 22rem wide and
              two full names wrapped the meta onto three lines. Who *wrote* it
              is one line down in the edit form, where you are already looking
              at the note in detail. */}
          <div className="mt-1 flex items-center gap-1.5 pl-7 text-label-small text-m-on-surface-variant">
            <Avatar person={note.assigned_to ? teamById.get(note.assigned_to) : undefined} colorById={colorById} />
            <span>{when(note.created_at)}</span>
            {done && note.done_at && <span>· done {when(note.done_at)}</span>}
          </div>
        </>
      )}
    </div>
  );
}
