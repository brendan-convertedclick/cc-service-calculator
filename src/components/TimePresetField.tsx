import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HOUR_PRESETS } from "@/lib/sprint-points";

/** Preset chips plus a free box, in hours. Same shape as the meeting Length
 *  control, so every time field on /staff and /approvals reads alike. Steps of
 *  0.25h keep the stored points whole: ClickUp refuses off-scale points. */
export function TimePresetField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (hours: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {HOUR_PRESETS.map((p) => (
        <Button
          key={p.h}
          type="button"
          size="sm"
          variant={Number(value) === p.h ? "default" : "outline"}
          aria-pressed={Number(value) === p.h}
          onClick={() => onChange(String(p.h))}
        >
          {p.label}
        </Button>
      ))}
      <Input
        id={id}
        type="number"
        min={0.25}
        step={0.25}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20"
        aria-label="Time in hours"
      />
      <span className="text-body-small text-m-on-surface-variant">h</span>
    </div>
  );
}
