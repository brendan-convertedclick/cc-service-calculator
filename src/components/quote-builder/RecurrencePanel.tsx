import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Database } from "@/types/db";

type Interval = Database["public"]["Enums"]["recurrence_interval"];

export type RecurrenceState = {
  is_recurring: boolean;
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
      <div className="rounded-md border border-m-outline-variant bg-m-surface p-3 space-y-3">
        <Label className="flex items-center gap-2 text-body-small">
          <input
            type="checkbox"
            checked={value.is_recurring}
            onChange={(e) => onChange({ ...value, is_recurring: e.target.checked })}
            className="h-4 w-4"
          />
          <Repeat className="h-4 w-4 text-m-on-surface-variant" />
          Recurring engagement — repeat all tasks on a schedule
        </Label>
        {value.is_recurring && (
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
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
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
              Leave end empty for ongoing retainers. Tasks repeat on each interval from the
              start date.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
