// src/components/productivity/DirectView.tsx
import { DirectData, computeBubbleRadii } from "@/hooks/useOutputMultiplier";
import { formatCurrency } from "@/lib/format";

const MEMBER_COLORS = [
  "#7C3AED", "#EC4899", "#0891B2", "#059669", "#D97706", "#E11D48", "#4F46E5",
];

interface Props {
  data: DirectData;
}

export function DirectView({ data }: Props) {
  const { members, totals, periodLabel } = data;

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      <div className="grid grid-cols-4 gap-3">
        <Chip label="Avg Multiplier" value={`${totals.avg_multiplier}×`} sub={periodLabel} />
        <Chip
          label="Human Hours"
          value={`${totals.total_human_hours.toFixed(1)}h`}
          sub="invested"
        />
        <Chip
          label="AI Session Hours"
          value={`${totals.total_ai_hours.toFixed(1)}h`}
          sub="across sessions"
        />
        <Chip
          label="AI Cost"
          value={formatCurrency(totals.total_cost_zar)}
          sub={
            totals.total_ai_hours > 0
              ? `${formatCurrency(totals.total_cost_zar / totals.total_ai_hours)}/hr`
              : "—"
          }
        />
      </div>

      {/* Bubble chart */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest mb-1">
          Output Expansion — by person
        </p>
        <p className="text-body-small text-m-on-surface-variant/60 mb-6">
          Inner circle = human hours · Middle ring = AI session hours · Outer ring = effective
          output (human × multiplier)
        </p>

        {members.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No sessions logged for this period. Use /log to record your first session.
          </p>
        ) : (
          <div className="flex flex-wrap gap-8 justify-around items-center py-4">
            {members.map((member, idx) => {
              const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
              const { innerR, middleR, outerR } = computeBubbleRadii(
                member.human_hours,
                member.ai_session_hours,
                member.multiplier,
              );
              const size = 200;
              const cx = size / 2;
              const cy = size / 2;

              return (
                <div key={member.email} className="flex flex-col items-center gap-3">
                  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    {/* Outer ring: effective output */}
                    <circle
                      cx={cx} cy={cy} r={outerR}
                      fill={`${color}12`}
                      stroke={`${color}33`}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    {/* Middle ring: AI session hours */}
                    <circle
                      cx={cx} cy={cy} r={middleR}
                      fill={`${color}1f`}
                      stroke={`${color}4d`}
                      strokeWidth={1}
                    />
                    {/* Inner circle: human hours */}
                    <circle
                      cx={cx} cy={cy} r={innerR}
                      fill={`${color}b3`}
                      stroke={color}
                      strokeWidth={2}
                    />
                    {/* Multiplier label */}
                    <text
                      x={cx} y={cy - 4}
                      textAnchor="middle"
                      fill={color}
                      fontSize={16}
                      fontWeight={800}
                      fontFamily="Inter, sans-serif"
                    >
                      {member.multiplier.toFixed(1)}×
                    </text>
                    <text
                      x={cx} y={cy + 13}
                      textAnchor="middle"
                      fill={`${color}99`}
                      fontSize={9}
                      fontFamily="Inter, sans-serif"
                    >
                      multiplier
                    </text>
                  </svg>
                  <p className="text-label-large text-m-on-surface">{member.display_name}</p>
                  <p className="text-body-small text-m-on-surface-variant">
                    {member.human_hours.toFixed(1)}h human ·{" "}
                    {member.ai_session_hours.toFixed(1)}h AI
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-5 mt-5 pt-4 border-t border-m-outline-variant">
          <LegendItem color="#7C3AED" opacity="solid" label="Human hours" />
          <LegendItem color="#7C3AED" opacity="medium" label="AI session hours" />
          <LegendItem color="#7C3AED" opacity="faint" label="Effective output" dashed />
        </div>
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

function LegendItem({
  color,
  opacity,
  label,
  dashed,
}: {
  color: string;
  opacity: "solid" | "medium" | "faint";
  label: string;
  dashed?: boolean;
}) {
  const fill =
    opacity === "solid" ? `${color}b3` : opacity === "medium" ? `${color}2f` : `${color}12`;
  return (
    <div className="flex items-center gap-2 text-body-small text-m-on-surface-variant">
      <svg width={12} height={12}>
        <circle
          cx={6} cy={6} r={5}
          fill={fill}
          stroke={`${color}4d`}
          strokeWidth={1}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
      </svg>
      {label}
    </div>
  );
}
