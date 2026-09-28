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
  hasValue,
  resultsOpen,
  type EntryValues,
  type FieldPhase,
  type ResultsTemplate,
  type ResultsTemplateField,
} from "@/lib/results-grid";
import { useSaveEntry } from "@/hooks/useResults";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stored values are in their DB unit (money = cents); the draft is in the
 * unit the input displays (money = rand) — this is the one place that
 * conversion happens, so displaying and saving never touch %100 again. */
function seedDraft(template: ResultsTemplate, values: EntryValues | undefined): EntryValues {
  const draft: EntryValues = {};
  if (!values) return draft;
  for (const field of template.fields) {
    const v = values[field.id];
    if (!hasValue(v)) continue;
    draft[field.id] = field.type === "money" ? Number(v) / 100 : v;
  }
  return draft;
}

/** Days in a given year/month — local Date is fine here, this isn't a stored
 * date, just the length of the month for the clamp. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function EntryPanel({
  clientId,
  rowId,
  rowName,
  groupName,
  year,
  month,
  template,
  values,
  day,
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
  day?: number | null;
  lastYearValues: EntryValues | undefined;
  now: { year: number; month: number };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EntryValues>(() => seedDraft(template, values));
  const [dayDraft, setDayDraft] = useState<string>(day ? String(day) : "");
  const save = useSaveEntry();

  useEffect(() => {
    setDraft(seedDraft(template, values));
    setDayDraft(day ? String(day) : "");
  }, [values, template, rowId, year, month, day]);

  const open = resultsOpen(year, month, now);
  const resultsStarted = template.fields.some((f) => f.phase === "result" && hasValue((values ?? {})[f.id]));

  function setField(fieldId: string, raw: string) {
    setDraft((d) => ({ ...d, [fieldId]: raw === "" ? null : raw }));
  }

  function fieldsFor(phase: FieldPhase) {
    return template.fields
      .filter((f) => f.phase === phase && (!f.retired_at || hasValue((values ?? {})[f.id])))
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  const compareLines = template.fields
    .filter((f) => f.phase === "result" && !f.retired_at && f.type !== "text" && f.type !== "date")
    .map((f) => ({ field: f, line: compareLine(f, values ?? {}, values ?? {}, lastYearValues ?? {}) }))
    .filter((x): x is { field: ResultsTemplateField; line: NonNullable<ReturnType<typeof compareLine>> } => !!x.line);

  function handleSave() {
    // draft is already in display units (money = rand) — convert once, here,
    // on the way out. toSave is a changeset, not the full entry: only a field
    // whose draft actually differs from the seeded (stored) value gets a key
    // at all (useSaveEntry only touches fields present as a key), so an
    // untouched money field is never re-multiplied and a retired field's kept
    // value is never rewritten. A field cleared back to blank still needs an
    // explicit `null` — omitting it entirely would read as "unchanged", not
    // "delete this".
    const stored = seedDraft(template, values);
    const toSave: EntryValues = {};
    for (const field of template.fields) {
      const raw = draft[field.id];
      const prev = stored[field.id];
      const rawNorm = hasValue(raw) ? raw : null;
      const prevNorm = hasValue(prev) ? prev : null;
      if (rawNorm === prevNorm) continue;
      if (!hasValue(raw)) {
        toSave[field.id] = null;
        continue;
      }
      if (field.type === "money") toSave[field.id] = Math.round(Number(raw) * 100);
      else if (field.type === "number" || field.type === "percent") toSave[field.id] = Number(raw);
      else toSave[field.id] = raw;
    }

    const trimmedDay = dayDraft.trim();
    const clampedDay = trimmedDay === "" ? null : Math.min(Math.max(1, Math.round(Number(trimmedDay))), daysInMonth(year, month));
    const storedDay = day ?? null;
    let dayToSave = clampedDay === storedDay ? undefined : clampedDay;

    // Keep Day and the plan phase's own Date metric in sync (review finding
    // 2) rather than letting entryDay's "day column wins" rule silently
    // strand a chip on the number the Day field last held. Day, explicitly
    // touched here, wins and the date follows it; otherwise a Date edit that
    // lands in this year+month sets Day; a Date edit that moves outside this
    // month is left alone — day is not cleared just because the date moved.
    const dateField = template.fields
      .filter((f) => f.phase === "plan" && f.type === "date" && !f.retired_at)
      .sort((a, b) => a.ordinal - b.ordinal)[0];
    if (dateField) {
      if (dayToSave !== undefined && dayToSave !== null) {
        toSave[dateField.id] = `${year}-${String(month).padStart(2, "0")}-${String(dayToSave).padStart(2, "0")}`;
      } else if (dayToSave === undefined && dateField.id in toSave) {
        const rawDate = toSave[dateField.id];
        if (hasValue(rawDate)) {
          const [dy, dm, dd] = String(rawDate).split("-").map(Number);
          if (dy === year && dm === month) dayToSave = dd;
        }
      }
    }

    save.mutate(
      { clientId, rowId, year, month, template, values: toSave, day: dayToSave },
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
          <div className="grid gap-1">
            <Label htmlFor="results-day" className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
              Day in {MONTH_NAMES[month - 1]} (optional)
            </Label>
            <Input
              id="results-day"
              type="number"
              inputMode="numeric"
              min={1}
              max={daysInMonth(year, month)}
              value={dayDraft}
              onChange={(e) => setDayDraft(e.target.value)}
              className="w-24"
            />
          </div>

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
  // draft values are already in display units (money = rand, see seedDraft) —
  // no per-render conversion here.
  const displayValue = hasValue(value) ? String(value) : "";

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
