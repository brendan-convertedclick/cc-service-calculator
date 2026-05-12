// src/components/productivity/PassiveView.tsx
import { PassiveData } from "@/hooks/useOutputMultiplier";
import { formatCurrency } from "@/lib/format";

const AGENT_ICONS: Record<string, string> = {
  "skill-intake": "📥",
  "skill-log": "📋",
  "skill-brief": "📝",
  "skill-scheduler": "📊",
  "skill-sow": "📄",
};

interface Props {
  data: PassiveData;
}

export function PassiveView({ data }: Props) {
  const { agents, totals, periodLabel } = data;
  const maxHours = Math.max(...agents.map((a) => a.estimated_human_hours), 1);

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <Chip
          label="Agents Built"
          value={String(new Set(agents.map((a) => a.id)).size)}
          sub="by this person"
        />
        <Chip
          label="Total Passive Hours"
          value={`${totals.total_passive_hours.toFixed(1)}h`}
          sub={periodLabel}
        />
        <Chip
          label="Equiv. Human Cost"
          value={formatCurrency(totals.total_cost_zar)}
          sub="at blended rate"
        />
      </div>

      {/* Agent leaderboard */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Agent output — {periodLabel}
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-5">
          Equivalent human hours delivered by each agent you built. Logged via /log with
          engagement type "Agent Run".
        </p>

        {agents.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No agent runs logged for this period. Use /log with "Agent Run" type.
          </p>
        ) : (
          <div className="space-y-0 divide-y divide-m-outline-variant/30">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 py-3">
                <div className="w-9 h-9 rounded-lg border border-m-primary/25 bg-m-primary/10 flex items-center justify-center text-base flex-shrink-0">
                  {AGENT_ICONS[agent.id] ?? "🤖"}
                </div>
                <div className="min-w-0">
                  <p className="text-label-large text-m-on-surface">{agent.name}</p>
                  <p className="text-body-small text-m-on-surface-variant/60 truncate">
                    {agent.description}
                  </p>
                </div>
                {/* Progress bar */}
                <div className="flex-1 mx-3 h-1.5 rounded-full bg-m-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-500/70"
                    style={{ width: `${(agent.estimated_human_hours / maxHours) * 100}%` }}
                  />
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-label-large text-m-on-surface">{agent.runs} runs</p>
                  <p className="text-body-small text-m-primary">
                    {agent.estimated_human_hours.toFixed(1)}h equiv.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total row */}
        {agents.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-m-outline-variant">
            <div>
              <p className="text-body-small text-m-on-surface-variant">
                Total passive leverage this {periodLabel.toLowerCase()}
              </p>
              <p className="text-body-small text-m-on-surface-variant/50">
                Equivalent human work produced by IP you built
              </p>
            </div>
            <p className="text-headline-small text-m-primary font-extrabold">
              {totals.total_passive_hours.toFixed(0)}h ·{" "}
              {formatCurrency(totals.total_cost_zar)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container-high p-4">
      <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-headline-small text-m-on-surface font-bold">{value}</p>
      <p className="text-body-small text-m-on-surface-variant/60 mt-0.5">{sub}</p>
    </div>
  );
}
