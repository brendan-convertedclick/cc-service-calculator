import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Database } from "@/types/db";

type Interval = Database["public"]["Enums"]["recurrence_interval"];
type Mode = Database["public"]["Enums"]["recurrence_mode"];

export type RecurrenceState = {
  mode: Mode;
  recurrence_interval: Interval | null;
  recurrence_start: string;
  recurrence_end: string;
};

export function RecurrencePanel({
  value,
  onChange,
}: {
  value: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
        Recurrence
      </div>
      <div className="rounded-xl border border-m-outline-variant bg-m-surface p-3 space-y-3">
        <div className="flex items-center gap-2 text-body-small text-m-on-surface">
          <Repeat className="h-4 w-4 text-m-on-surface-variant" />
          <span>How should this engagement repeat?</span>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-m-surface-container-low p-1">
          {(["none", "project", "per_service"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...value, mode: m })}
              className={
                "rounded-md px-2 py-1.5 text-label-small transition-colors " +
                (value.mode === m
                  ? "bg-m-surface shadow-elev-1 text-m-on-surface"
                  : "text-m-on-surface-variant hover:text-m-on-surface")
              }
            >
              {m === "none" ? "One-off" : m === "project" ? "Whole project" : "Per service"}
            </button>
          ))}
        </div>

        {value.mode === "project" && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">Interval</Label>
              <select
                value={value.recurrence_interval ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    recurrence_interval: (e.target.value || null) as Interval | null,
                  })
                }
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-label-small text-m-on-surface-variant">Start</Label>
                <Input
                  type="date"
                  value={value.recurrence_start}
                  onChange={(e) => onChange({ ...value, recurrence_start: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-label-small text-m-on-surface-variant">End</Label>
                <Input
                  type="date"
                  value={value.recurrence_end}
                  onChange={(e) => onChange({ ...value, recurrence_end: e.target.value })}
                  placeholder="Ongoing"
                />
              </div>
            </div>
            <p className="text-label-small text-m-on-surface-variant">
              Every line repeats together. Leave end empty for ongoing retainers.
            </p>
          </div>
        )}

        {value.mode === "per_service" && (
          <p className="text-label-small text-m-on-surface-variant pt-1">
            Configure recurrence on each service below. Lines not marked recurring run once.
          </p>
        )}
      </div>
    </div>
  );
}
