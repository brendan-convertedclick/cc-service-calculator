// src/components/results/templates/TemplateEditor.tsx
//
// Right pane of /results/templates: template name, grid preview, Plan and
// Results field tables, Save/Discard. All state is the caller's draft — this
// component is pure render + callbacks, no data fetching of its own.

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldTable } from "./FieldTable";
import { NUMERIC_TYPES, type DraftField } from "./types";

function previewValue(type: DraftField["type"]): string {
  if (type === "money") return "R4,500";
  if (type === "percent") return "3.8%";
  return "84";
}

export function TemplateEditor({
  name,
  fields,
  usage,
  lockedIds,
  saving,
  dirty,
  onNameChange,
  onFieldChange,
  onToggleStar,
  onToggleRetire,
  onAddField,
  onSave,
  onDiscard,
}: {
  name: string;
  fields: DraftField[];
  usage: number | undefined;
  lockedIds: Set<string>;
  saving: boolean;
  dirty: boolean;
  onNameChange: (name: string) => void;
  onFieldChange: (key: string, patch: Partial<DraftField>) => void;
  onToggleStar: (key: string) => void;
  onToggleRetire: (key: string) => void;
  onAddField: (phase: "plan" | "result") => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const starred = fields
    .filter((f) => f.star && f.phase === "result" && !f.retired_at)
    .slice(0, 2);
  const planTargets = fields.filter(
    (f) => f.id && f.phase === "plan" && !f.retired_at && NUMERIC_TYPES.includes(f.type),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Master template</span>
          <Input
            aria-label="Template name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="h-auto border-none px-0 text-headline-small font-semibold shadow-none focus-visible:ring-0"
          />
          <p className="text-body-small text-m-on-surface-variant">
            Applies to every client.{" "}
            {usage === undefined ? "" : usage > 0 ? `Used by ${usage} row${usage === 1 ? "" : "s"}.` : "Used by no rows yet."}
          </p>
        </div>
        <div className="grid gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
          <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Grid preview</span>
          <div className="flex min-w-40 flex-wrap gap-x-3 gap-y-1 rounded-md bg-m-primary-container p-2 text-m-on-primary-container">
            {starred.length ? (
              starred.map((f) => (
                <span key={f._key} className="text-body-small">
                  <b>{previewValue(f.type)}</b> {f.short_label || f.label}
                </span>
              ))
            ) : (
              <span className="text-body-small opacity-70">Star a result to show it here</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-title-small">Plan</h3>
          <span className="text-label-small text-m-on-surface-variant">Asked before the month</span>
        </div>
        <FieldTable
          phase="plan"
          fields={fields}
          planFields={planTargets}
          lockedIds={lockedIds}
          onChange={onFieldChange}
          onToggleStar={onToggleStar}
          onToggleRetire={onToggleRetire}
          onAdd={() => onAddField("plan")}
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-title-small">Results</h3>
          <span className="text-label-small text-m-on-surface-variant">Asked after the month. Up to two starred show on the grid.</span>
        </div>
        <FieldTable
          phase="result"
          fields={fields}
          planFields={planTargets}
          lockedIds={lockedIds}
          onChange={onFieldChange}
          onToggleStar={onToggleStar}
          onToggleRetire={onToggleRetire}
          onAdd={() => onAddField("result")}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-m-outline-variant pt-4">
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="button" disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
