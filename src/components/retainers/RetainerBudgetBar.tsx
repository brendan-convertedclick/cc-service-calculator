import type { CSSProperties } from "react";
import {
  budgetVerdict,
  DEPT_GROUP_LABEL,
  formatHours as h,
  type DeptGroup,
  type RetainerBudget,
} from "@/lib/retainer-budget";

// Full class names, so Tailwind can see them.
const FILL: Record<DeptGroup, string> = {
  dev: "bg-m-dept-dev", creative: "bg-m-dept-creative", seo: "bg-m-dept-seo", paid: "bg-m-dept-paid",
  social: "bg-m-dept-social", strategy: "bg-m-dept-strategy", admin: "bg-m-dept-admin", none: "bg-m-dept-none",
};
const EDGE: Record<DeptGroup, string> = {
  dev: "border-m-dept-dev", creative: "border-m-dept-creative", seo: "border-m-dept-seo", paid: "border-m-dept-paid",
  social: "border-m-dept-social", strategy: "border-m-dept-strategy", admin: "border-m-dept-admin", none: "border-m-dept-none",
};

const hatch = (colour: string): CSSProperties => ({
  backgroundImage: `repeating-linear-gradient(135deg, hsl(var(--mcolor-${colour})) 0 5px, transparent 5px 9px)`,
});

interface Seg { key: string; group: DeptGroup | "ask"; kind: "spent" | "todo" | "ask"; from: number; size: number; title: string }

export function RetainerBudgetBar({
  budget: b,
  askHours = 0,
  showDepartments = false,
}: {
  budget: RetainerBudget;
  askHours?: number;
  showDepartments?: boolean;
}) {
  const ask = Math.max(0, askHours);
  const end = Math.max(b.budget, b.spent + b.toDo + ask, 0.01);
  const pc = (v: number) => (v / end) * 100;

  // Spent first (by department), then To do in the same colours, then the ask.
  const segs: Seg[] = [];
  let pos = 0;
  const put = (s: Omit<Seg, "from">) => { segs.push({ ...s, from: pos }); pos += s.size; };
  for (const d of b.departments) if (d.spent > 0) put({ key: `s-${d.group}`, group: d.group, kind: "spent", size: d.spent, title: `${DEPT_GROUP_LABEL[d.group]}: ${h(d.spent)} spent` });
  for (const d of b.departments) if (d.toDo > 0) put({ key: `t-${d.group}`, group: d.group, kind: "todo", size: d.toDo, title: `${DEPT_GROUP_LABEL[d.group]}: ${h(d.toDo)} to do` });
  if (ask > 0) put({ key: "ask", group: "ask", kind: "ask", size: ask, title: `This request: ${h(ask)}` });

  const fullyBooked = Math.abs(b.free) < 0.05;
  const allocSum = b.departments.reduce((s, d) => s + d.alloc, 0);
  const verdict = ask > 0 ? budgetVerdict(b, ask) : null;

  const render = (s: Seg, from: number, size: number, past: boolean) => {
    const style: CSSProperties = { left: `${pc(from)}%`, width: `${pc(size)}%`, ...(past ? { opacity: 0.55 } : {}) };
    const cls = "absolute top-[3px] bottom-[3px]";
    if (s.kind === "ask")
      return <div key={s.key + from} title={s.title} className={`${cls} border-l-2 border-m-budget-ask`} style={{ ...style, ...hatch("budget-ask") }} />;
    const g = s.group as DeptGroup;
    return s.kind === "spent"
      ? <div key={s.key + from} title={s.title} className={`${cls} ${FILL[g]}`} style={style} />
      : <div key={s.key + from} title={s.title} className={`${cls} rounded-[3px] border-[1.5px] border-dashed bg-m-surface-container ${EDGE[g]}`} style={style} />;
  };

  // A segment crossing the box edge is split: the inside as drawn, the rest faded (spent also gets a red hatch).
  const nodes = segs.flatMap((s) => {
    const inside = Math.max(0, Math.min(s.size, b.budget - s.from));
    const out = s.size - inside;
    const parts = [];
    if (inside > 0) parts.push(render(s, s.from, inside, false));
    if (out > 0) {
      parts.push(render(s, s.from + inside, out, true));
      // Only spent hours past the box are "over". To do past it is "short" and keeps its faded dashed outline.
      if (s.kind === "spent") parts.push(<div key={`o-${s.key}`} data-hatch="error" className="absolute top-[3px] bottom-[3px]" style={{ left: `${pc(s.from + inside)}%`, width: `${pc(out)}%`, ...hatch("error") }} />);
    }
    return parts;
  });

  return (
    <div className="space-y-1.5 tabular-nums">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div
            role="img"
            aria-label={`${h(b.spent)} spent, ${h(b.toDo)} to do, of ${h(b.budget)} budget`}
            className="relative h-6 w-full"
          >
            <div className="absolute inset-y-0 left-0 rounded-md border-[1.5px] border-m-outline bg-m-surface-container-low" style={{ width: `${pc(b.budget)}%` }} />
            {nodes}
          </div>
          {showDepartments && (
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-body-small text-m-on-surface-variant">
              {b.departments.map((d) => (
                <span key={d.group} className="inline-flex items-center gap-1">
                  <i className={`inline-block h-2 w-2 rounded-sm ${FILL[d.group]}`} />
                  {DEPT_GROUP_LABEL[d.group]}{" "}
                  <b className={d.spent + d.toDo > d.alloc + 0.05 ? "text-m-budget-warn" : "text-m-on-surface"}>
                    {h(d.spent)}{d.toDo > 0 ? ` + ${h(d.toDo)}` : ""} / {h(d.alloc)}
                  </b>
                </span>
              ))}
              <span>Not split <b className="text-m-on-surface">{h(Math.max(0, b.budget - allocSum))}</b></span>
              {allocSum > b.budget + 0.05 && (
                <span className="text-m-budget-warn">Split adds up to {h(allocSum)}, more than the budget</span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          {fullyBooked ? (
            <div className="text-label-large text-m-budget-warn">Fully booked</div>
          ) : b.free > 0 ? (
            <div className="text-label-large text-m-budget-ok">{h(b.free)} free</div>
          ) : (
            <div className="text-label-large text-m-error">{h(-b.free)} short</div>
          )}
          <div className="text-body-small text-m-on-surface-variant">
            {b.spent > b.budget ? `already ${h(b.spent - b.budget)} over` : `${h(b.unspent)} unspent`}
          </div>
        </div>
      </div>
      {verdict && (
        <p className={`text-body-small ${verdict === "fits" ? "text-m-budget-ok" : verdict === "uses_todo" ? "text-m-budget-warn" : "text-m-error"}`}>
          {verdict === "fits" && "Fits in Free. No approval needed."}
          {verdict === "uses_todo" && `Only ${h(Math.max(0, b.free))} is free. The rest is already promised to work in To do.`}
          {verdict === "over_budget" && `${h(ask - Math.max(0, b.unspent))} past the budget. Someone has to decide who pays.`}
        </p>
      )}
      {b.unestimated > 0 && (
        <p className="text-body-small text-m-budget-warn">
          {b.unestimated} open {b.unestimated === 1 ? "task has" : "tasks have"} no estimate, so To do is understated.
        </p>
      )}
    </div>
  );
}
