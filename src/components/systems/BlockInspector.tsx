// Right rail — one selected step's editable fields, matching
// docs/2026-08-05-systems-canvas-visual-spec.html's inspector layout
// (Title · Goal · Department · Responsible · Estimated hours · Incoming ·
// Revision). Selection (which step, if any) is owned by SystemCanvas.tsx;
// this component loads its own useUpdateStep mutation and commits per-field
// on blur / on select — no form wrapper exists in this codebase, so each
// field is wired by hand.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUpdateStep } from "@/hooks/useProcessSteps";
import { memberColors } from "@/hooks/useTeam";
import { MATERIALISE_LABEL } from "@/hooks/useSystemDefinitions";
import { initials } from "./SystemBlockNode";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type DeptRow = Database["public"]["Tables"]["departments"]["Row"];
type TeamRow = Database["public"]["Tables"]["team_members"]["Row"];
type MaterialiseMode = Database["public"]["Enums"]["materialise_mode"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

// Radix Select can't hold a "" value — this stands in for "no department" /
// "no owner" and is translated back to null on commit.
const NONE = "__none__";
const MATERIALISE_OPTIONS: MaterialiseMode[] = ["task", "checklist_item", "none"];

type InspectorForm = {
  title: string;
  goal: string;
  department_id: string;
  owner_id: string;
  hours: string;
  materialise_as: MaterialiseMode;
};

function toForm(step: Step): InspectorForm {
  return {
    title: step.title,
    goal: step.goal_statement ?? "",
    department_id: step.department_id ?? "",
    owner_id: step.owner_id ?? "",
    hours: step.estimated_hours != null ? String(step.estimated_hours) : "",
    materialise_as: step.materialise_as,
  };
}

export function BlockInspector({
  step,
  depts,
  team,
  incomingLabel,
  revisionLabel,
  onDelete,
}: {
  step: Step | null;
  depts: DeptRow[];
  team: TeamRow[];
  incomingLabel: string | null;
  revisionLabel: string;
  /** Opens the canvas's confirm dialog — this panel never deletes directly. */
  onDelete?: () => void;
}) {
  const update = useUpdateStep();
  const colorById = useMemo(() => memberColors(team), [team]);
  const [form, setForm] = useState<InspectorForm | null>(step ? toForm(step) : null);

  // Re-seed on the selected step's identity, not on every background refetch
  // (a mutation from this very panel invalidates ["process_steps"]) —
  // otherwise a keystroke could get clobbered mid-edit by its own refetch.
  // Title is the one exception: the Steps list renames in place too, and
  // without it this panel keeps showing the old title — then writes it back
  // on the next blur, silently undoing the rename.
  useEffect(() => {
    setForm(step ? toForm(step) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id, step?.title]);

  if (!step || !form) {
    return (
      <div className="flex w-[186px] flex-none flex-col items-center justify-center gap-1 border-l border-m-outline-variant bg-m-surface-container p-3 text-center">
        <p className="text-label-small text-m-on-surface-variant">Select a block to see its details.</p>
      </div>
    );
  }

  const isSubStep = step.parent_id != null;
  const department = form.department_id ? depts.find((d) => d.id === form.department_id) ?? null : null;
  const owner = form.owner_id ? team.find((t) => t.id === form.owner_id) ?? null : null;

  function commit(patch: StepUpdate) {
    update.mutate(
      { id: step!.id, patch },
      {
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "Could not save");
          // Don't leave the field showing a value the DB just rejected.
          setForm(toForm(step!));
        },
      }
    );
  }

  return (
    <div className="w-[186px] flex-none space-y-3 overflow-y-auto border-l border-m-outline-variant bg-m-surface-container p-3">
      <p className="text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Block inspector
      </p>

      <Field label="Title">
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (!value) {
              toast.error("Title can't be empty");
              setForm(toForm(step));
              return;
            }
            commit({ title: value });
          }}
          className="h-8 text-label-medium"
        />
      </Field>

      <Field label="Goal / purpose">
        <Textarea
          value={form.goal}
          onChange={(e) => setForm({ ...form, goal: e.target.value })}
          onBlur={(e) => commit({ goal_statement: e.target.value.trim() || null })}
          rows={3}
          className="text-label-medium italic"
          placeholder="What is this step for?"
        />
      </Field>

      <Field label="Department">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 flex-none rounded-sm"
            style={{ background: department?.color ?? "hsl(var(--mcolor-outline-variant))" }}
          />
          <Select
            value={form.department_id || NONE}
            onValueChange={(v) => {
              const value = v === NONE ? null : v;
              setForm({ ...form, department_id: value ?? "" });
              commit({ department_id: value });
            }}
          >
            <SelectTrigger className="h-8 min-w-0 flex-1 text-label-medium">
              <SelectValue placeholder="— none" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— none</SelectItem>
              {depts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>

      <Field label="Responsible">
        <div className="flex min-w-0 items-center gap-1.5">
          {owner && (
            <span
              className={cn(
                "grid h-5 w-5 flex-none place-items-center rounded-full text-label-small font-bold leading-none",
                colorById.has(owner.id) ? "text-white" : "bg-m-secondary-container text-m-on-secondary-container"
              )}
              style={colorById.has(owner.id) ? { background: colorById.get(owner.id) } : undefined}
            >
              {initials(owner.full_name)}
            </span>
          )}
          <Select
            value={form.owner_id || NONE}
            onValueChange={(v) => {
              const value = v === NONE ? null : v;
              setForm({ ...form, owner_id: value ?? "" });
              commit({ owner_id: value });
            }}
          >
            <SelectTrigger className="h-8 min-w-0 flex-1 text-label-medium">
              <SelectValue placeholder="— unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— unassigned</SelectItem>
              {team.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>

      {isSubStep ? (
        // process_steps_substep_no_hours forbids hours on a sub-step, and the
        // P3 materialise matrix ignores materialise_as for sub-steps (always
        // a checklist item on the parent) — hiding both rather than shipping
        // controls that would either 400 or silently do nothing.
        <p className="rounded-md bg-m-surface-container-high px-2 py-1.5 text-label-small text-m-on-surface-variant">
          Sub-steps carry no hours of their own and always materialise as a checklist item on
          their parent's task.
        </p>
      ) : (
        <>
          <Field label="Estimated hours">
            <Input
              type="number"
              step="0.25"
              min="0.25"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  commit({ estimated_hours: null });
                  return;
                }
                const parsed = Number(raw);
                if (Number.isNaN(parsed)) {
                  toast.error("Hours must be a number");
                  setForm(toForm(step));
                  return;
                }
                commit({ estimated_hours: parsed });
              }}
              className="h-8 font-mono text-label-medium font-semibold text-m-primary"
            />
          </Field>

          <Field label="Materialise as">
            <Select
              value={form.materialise_as}
              onValueChange={(v) => {
                const value = v as MaterialiseMode;
                setForm({ ...form, materialise_as: value });
                commit({ materialise_as: value });
              }}
            >
              <SelectTrigger className="h-8 text-label-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATERIALISE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MATERIALISE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      <Field label="Incoming">
        <p
          className={cn(
            "text-label-medium",
            incomingLabel?.startsWith("⇄") ? "font-semibold text-m-secondary" : "text-m-on-surface-variant"
          )}
        >
          {incomingLabel ?? "—"}
        </p>
      </Field>

      <Field label="Revision">
        <p className="text-label-medium text-m-on-surface-variant">{revisionLabel}</p>
      </Field>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-m-outline-variant py-1.5 text-label-medium text-m-on-surface-variant hover:border-m-error hover:bg-m-error-container hover:text-m-on-error-container"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {isSubStep ? "sub-step" : "step"}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">
        {label}
      </Label>
      {children}
    </div>
  );
}
