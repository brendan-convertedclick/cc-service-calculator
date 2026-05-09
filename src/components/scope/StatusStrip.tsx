import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";

type ActualRow = Database["public"]["Views"]["project_actuals_current"]["Row"];
type Quote = Database["public"]["Tables"]["quotes"]["Row"];

const quoteStatusColor: Record<string, string> = {
  draft: "bg-m-surface-container text-m-on-surface-variant",
  sent: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

function formatZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100
  );
}

interface Props {
  actuals: ActualRow[];
  quote?: Quote | null;
  briefCount: number;
  prompts?: ClaudePrompt[];
}

export function StatusStrip({ actuals, quote, briefCount, prompts = [] }: Props) {
  const totalUsed = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
  const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);
  const pct = totalPlanned > 0 ? Math.min((totalUsed / totalPlanned) * 100, 100) : 0;

  return (
    <aside className="flex flex-col gap-6 border-l border-m-outline-variant bg-m-surface p-5 overflow-y-auto">
      {/* Burn */}
      <section>
        <h3 className="mb-2 text-label-large text-m-on-surface">Budget</h3>
        <p className="text-label-small text-m-on-surface-variant">
          {totalUsed}h used / {totalPlanned}h planned
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-m-surface-container">
          <div
            data-testid="burn-bar"
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-green-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {actuals.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {actuals.map((a) => (
              <div key={a.dept_id ?? a.id} className="flex items-center justify-between">
                <span className="text-label-small text-m-on-surface-variant">
                  {a.dept_id ?? "—"}
                </span>
                <span className="text-label-small text-m-on-surface">
                  {a.actual_hours ?? 0}h / {a.planned_hours ?? 0}h
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Briefs */}
      <section>
        <h3 className="mb-2 text-label-large text-m-on-surface">Briefs</h3>
        <p data-testid="brief-count" className="text-display-small text-m-on-surface">
          {briefCount}
        </p>
        <p className="text-label-small text-m-on-surface-variant">linked threads</p>
      </section>

      {/* Quote */}
      {quote && (
        <section>
          <h3 className="mb-2 text-label-large text-m-on-surface">Quote</h3>
          <p className="text-body-large font-medium text-m-on-surface">
            {formatZAR(quote.total_cents ?? 0)}
          </p>
          <span
            className={cn(
              "mt-1 inline-block rounded px-2 py-0.5 text-label-small",
              quoteStatusColor[quote.status as string] ??
                "bg-m-surface-container text-m-on-surface-variant"
            )}
          >
            {quote.status}
          </span>
        </section>
      )}
      <ClaudePromptPanel prompts={prompts} />
    </aside>
  );
}
