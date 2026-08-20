// The notes panel: pick a task or one of its steps, leave a note against it,
// tick it off when it's dealt with.
//
// Notes used to be one textarea per row, inline in the list. That gave a
// procedure one anonymous, undated line per step — fine for "the login is in
// 1Password", useless for "Sarah says the client changed the template on
// 3 March". Here every note carries a name and a date, and the list badges
// each row with how many are still open.
//
// Docked, not a dialog: a Sheet lays an overlay over the page, and reading a
// note while editing the task it is about is the whole point. This is a column
// beside the editor — open it and the editor narrows, both stay usable.
import { useEffect, useState } from "react";
import { Check, PanelRightClose, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCurrentUserId } from "@/context/AuthContext";
import {
  useAddStepNote,
  useDeleteStepNote,
  useStepNotes,
  useToggleStepNote,
  type StepNote,
} from "@/hooks/useStepNotes";
import { groupProcedure } from "@/lib/procedure-shape";
import { cn, errorMessage } from "@/lib/utils";
import type { Database } from "@/types/db";

type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];
type TeamRow = { id: string; full_name: string };

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
  const toggle = useToggleStepNote(systemId);
  const remove = useDeleteStepNote(systemId);
  const [body, setBody] = useState("");
  const teamById = new Map(team.map((t) => [t.id, t]));

  const groups = groupProcedure(tasks, steps);
  const row = [...tasks, ...steps].find((r) => r.id === rowId) ?? null;
  const rowNotes = notes.filter((n) => n.step_id === rowId);

  // A note typed against one row must not follow you to the next one.
  useEffect(() => setBody(""), [rowId]);

  function submit() {
    const trimmed = body.trim();
    if (!trimmed || !rowId) return;
    add.mutate(
      { stepId: rowId, body: trimmed, authorId: currentUserId },
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
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClose} title="Slide the notes out">
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        {/* Which row the note lands on. Opening from a row preselects it; the
            picker is here so you can move down the procedure without closing
            the panel and hunting for the next sticky-note icon. */}
        <select
          value={rowId ?? ""}
          aria-label="Task or step this note is about"
          onChange={(e) => onSelectRow(e.target.value)}
          className="mt-4 h-10 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
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
              <div className="flex justify-end">
                <Button size="sm" disabled={!body.trim() || add.isPending} onClick={submit}>
                  {add.isPending ? "Adding…" : "Add note"}
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2 pb-6">
              {rowNotes.length === 0 && (
                <p className="text-body-small text-m-on-surface-variant">
                  No notes on this one yet.
                </p>
              )}
              {rowNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  teamById={teamById}
                  busy={toggle.isPending || remove.isPending}
                  onToggle={(done) =>
                    toggle.mutate(
                      { id: note.id, done, byId: currentUserId },
                      { onError: (e) => toast.error(`Could not update that note: ${errorMessage(e)}`) }
                    )
                  }
                  onDelete={() =>
                    remove.mutate(note.id, {
                      onError: (e) => toast.error(`Could not delete that note: ${errorMessage(e)}`),
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
    </aside>
  );
}

function NoteCard({
  note,
  teamById,
  busy,
  onToggle,
  onDelete,
}: {
  note: StepNote;
  teamById: Map<string, TeamRow>;
  busy: boolean;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
}) {
  const done = note.done_at != null;
  // The shared team@ login has no team_members row, so a real note can still
  // have no author — say so rather than leave the line unattributed.
  const who = (id: string | null) => (id ? teamById.get(id)?.full_name ?? "Someone" : "Someone");
  const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        done ? "border-m-outline-variant bg-m-surface-container-low" : "border-m-outline-variant bg-m-surface"
      )}
    >
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
          aria-label="Delete this note"
          title="Delete"
          disabled={busy}
          onClick={onDelete}
          className="mt-0.5 flex-none rounded p-1 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 pl-7 text-label-small text-m-on-surface-variant">
        {who(note.created_by)} · {when(note.created_at)}
        {done && note.done_at && ` · done by ${who(note.done_by)} ${when(note.done_at)}`}
      </p>
    </div>
  );
}
