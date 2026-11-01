import { useState } from "react";
import { RetainerBudgetBar } from "@/components/retainers/RetainerBudgetBar";
import { Switch } from "@/components/ui/switch";
import { useRetainerBudget } from "@/hooks/useRetainerBudget";

const h = (n: number) => `${Math.round(n * 10) / 10}h`;

/** Every budgeted retainer for the month, tightest first. Admin view of the same bar staff see. */
export function RetainerBudgetBoard({ month }: { month: string }) {
  const { data, isLoading, isError } = useRetainerBudget(month);
  const [depts, setDepts] = useState(false);

  if (isLoading) return <p className="text-body-small text-m-on-surface-variant">Loading budgets…</p>;
  if (isError) return <p className="text-body-small text-m-on-surface-variant">Couldn't load budgets.</p>;

  const all = [...(data ?? [])].sort((a, b) => a.free - b.free);
  const short = all.filter((b) => b.free <= -0.05);
  const roomy = all.filter((b) => b.free >= 0.05);
  const sum = (xs: typeof all) => xs.reduce((s, b) => s + Math.abs(b.free), 0);
  const summary = [
    short.length && `${short.length} ${short.length === 1 ? "retainer" : "retainers"} short by ${h(sum(short))}.`,
    roomy.length && `${roomy.length} with ${h(sum(roomy))} free.`,
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-medium text-m-on-surface">{summary}</p>
        <label className="flex items-center gap-2 text-body-small text-m-on-surface-variant">
          <Switch checked={depts} onCheckedChange={setDepts} />
          Show each department's share
        </label>
      </div>
      {all.map((b) => (
        <div key={b.projectId} className="space-y-1">
          <p className="text-label-large text-m-on-surface">{b.projectName}</p>
          <p className="text-body-small text-m-on-surface-variant">{b.clientName}</p>
          <RetainerBudgetBar budget={b} showDepartments={depts} />
        </div>
      ))}
    </div>
  );
}
