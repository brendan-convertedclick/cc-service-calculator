// src/components/results/EntryPanel.tsx
//
// Side panel for one cell: plan fields, result fields (disabled until the
// month starts — rule 7), and "How it compares" against last year. Explicit
// Save (no autosave, see CLAUDE.md).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn, errorMessage } from "@/lib/utils";
import {
  compareLine,
  resultsOpen,
  type EntryValues,
  type FieldPhase,
  type ResultsTemplate,
  type ResultsTemplateField,
} from "@/lib/results-grid";
import { useSaveEntry } from "@/hooks/useResults";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const has = (v: number | string | null | undefined) => v !== undefined && v !== null && v !== "";

export function EntryPanel({
  clientId,
  rowId,
  rowName,
  groupName,
  year,
  month,
  template,
  values,
  lastYearValues,
  now,
  onClose,
}: {
  clientId: string;
  rowId: string;
  rowName: string;
  groupName: string;
  year: number;
  month: number;
  template: ResultsTemplate;
  values: EntryValues | undefined;
  lastYearValues: EntryValues | undefined;
  now: { year: number; month: number };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EntryValues>(values ?? {});
  const save = useSaveEntry();

  useEffect(() => {
    setDraft(values ?? {});
  }, [values, rowId, year, month]);

  const open = resultsOpen(year, month, now);
  const resultsStarted = template.fields.some((f) => f.phase === "result" && has((values ?? {})[f.id]));

  function setField(fieldId: string, raw: string) {
    setDraft((d) => ({ ...d, [fieldId]: raw === "" ? null : raw }));
  }

  function fieldsFor(phase: FieldPhase) {
    return template.fields
      .filter((f) => f.phase === phase && (!f.retired_at || has((values ?? {})[f.id])))
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  const compareLines = template.fields
    .filter((f) => f.phase === "result" && !f.retired_at && f.type !== "text" && f.type !== "date")
    .map((f) => ({ field: f, line: compareLine(f, values ?? {}, values ?? {}, lastYearValues ?? {}) }))
    .filter((x): x is { field: ResultsTemplateField; line: NonNullable<ReturnType<typeof compareLine>> } => !!x.line);

  function handleSave() {
    // Coerce numeric-typed fields' string drafts to numbers, money entered as
    // rand converted to cents (project convention: money is int cents).
    const toSave: EntryValues = {};
    for (const field of template.fields) {
      const raw = draft[field.id];
      if (!has(raw)) continue;
      if (field.type === "money") toSave[field.id] = Math.round(Number(raw) * 100);
      else if (field.type === "number" || field.type === "percent") toSave[field.id] = Number(raw);
      else toSave[field.id] = raw;
    }
    save.mutate(
      { clientId, rowId, year, month, template, values: toSave },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`),
      },
    );
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <SheetHeader className="mb-2 text-left">
          <span className="text-label-medium uppercase tracking-wide text-m-on-surface-variant">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <SheetTitle>{rowName}</SheetTitle>
          <span className="text-body-medium text-m-on-surface-variant">
            {groupName} · {template.name} template
          </span>
        </SheetHeader>

        <div className="grid gap-4">
          <FieldGroup title="Plan" hint={values ? "Planned" : "Not planned yet"}>
            {fieldsFor("plan").map((f) => (
              <FieldInput key={f.id} field={f} value={draft[f.id]} disabled={!!f.retired_at} onChange={setField} />
            ))}
          </FieldGroup>

          <FieldGroup title="Results" hint={resultsStarted ? "Recorded" : open ? "Due now" : `Opens after ${MONTH_NAMES[month - 1]}`}>
            {fieldsFor("result").map((f) => (
              <FieldInput
                key={f.id}
                field={f}
                value={draft[f.id]}
                disabled={!!f.retired_at || !open}
                onChange={setField}
              />
            ))}
          </FieldGroup>

          {compareLines.length > 0 && (
            <div className="grid gap-2 rounded-lg border border-m-outline-variant bg-m-surface-container-low p-3">
              <h3 className="text-title-small">How it compares</h3>
              <ul className="grid gap-1.5 text-body-medium text-m-on-surface-variant">
                {compareLines.map(({ field, line }) => (
                  <li key={field.id}>
                    <b className="text-m-on-surface">{field.label}</b> {line.value || "not in yet"}
                    {line.target && (
                      <span className={line.target.met ? "text-green-700 dark:text-green-400" : "text-rose-700 dark:text-rose-400"}>
                        {" "}
                        of {line.target.value} target
                      </span>
                    )}
                    {line.lastYear && (
                      <>
                        {" "}· {year - 1}: {line.lastYear.value}
                        {line.lastYear.deltaPct !== undefined && (
                          <span className={line.lastYear.deltaPct >= 0 ? "text-green-700 dark:text-green-400" : "text-rose-700 dark:text-rose-400"}>
                            {" "}
                            {line.lastYear.deltaPct >= 0 ? "+" : ""}
                            {line.lastYear.deltaPct}%
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FieldGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-3 rounded-lg border border-m-outline-variant p-3")}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-title-small">{title}</h3>
        <span className="text-label-small text-m-on-surface-variant">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ResultsTemplateField;
  value: number | string | null | undefined;
  disabled: boolean;
  onChange: (fieldId: string, raw: string) => void;
}) {
  const id = `results-field-${field.id}`;
  const displayValue =
    field.type === "money" && has(value) ? String(Number(value) / 100) : has(value) ? String(value) : "";

  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
        {field.star && <span className="text-amber-500">★ </span>}
        {field.label}
      </Label>
      {field.type === "text" ? (
        <Textarea
          id={id}
          rows={2}
          value={displayValue}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      ) : field.type === "date" ? (
        <Input
          id={id}
          type="date"
          value={displayValue}
          disabled={disabled}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      ) : (
        <div className="flex items-center gap-1.5 rounded-md border border-m-outline bg-m-surface-container-low px-2.5">
          {field.type === "money" && <span className="text-m-on-surface-variant">R</span>}
          <Input
            id={id}
            type="number"
            step="any"
            inputMode="decimal"
            value={displayValue}
            disabled={disabled}
            onChange={(e) => onChange(field.id, e.target.value)}
            className="border-0 bg-transparent px-0 focus-visible:ring-0"
          />
          {field.type === "percent" && <span className="text-m-on-surface-variant">%</span>}
        </div>
      )}
    </div>
  );
}
