import { cn } from "@/lib/utils";

type Row = { dept_id: string; dept_name: string; planned: number; actual: number };

export function BurnChart({ rows }: { rows: Row[] }) {
  const max = Math.max(...rows.map((r) => Math.max(r.planned, r.actual)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const ratio = r.planned > 0 ? r.actual / r.planned : 0;
        const color =
          ratio > 1.2 ? "bg-destructive" : ratio > 1.0 ? "bg-amber-500" : "bg-m-primary";
        return (
          <div key={r.dept_id}>
            <div className="flex items-center justify-between text-label-small">
              <span>{r.dept_name}</span>
              <span>
                {r.actual.toFixed(1)} / {r.planned.toFixed(1)} h
              </span>
            </div>
            <div className="relative mt-1 h-3 w-full rounded-full bg-m-surface-container">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-m-outline-variant"
                style={{ width: `${(r.planned / max) * 100}%` }}
              />
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", color)}
                style={{ width: `${(r.actual / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
