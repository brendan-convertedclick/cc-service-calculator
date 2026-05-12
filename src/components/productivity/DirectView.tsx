// src/components/productivity/DirectView.tsx
import { useState } from "react";
import {
  DirectData,
  BreakdownSlice,
  computeBubbleRadii,
  MultiplierPeriod,
} from "@/hooks/useOutputMultiplier";
import { formatCurrency } from "@/lib/format";

const MEMBER_COLORS = [
  "#7C3AED", "#EC4899", "#0891B2", "#059669", "#D97706", "#E11D48", "#4F46E5",
];

const BREAKDOWN_LABEL: Record<MultiplierPeriod, string> = {
  week: "Daily",
  month: "Weekly",
  year: "Monthly",
};

interface Props {
  data: DirectData;
  period: MultiplierPeriod;
}

export function DirectView({ data, period }: Props) {
  const { members, totals, periodLabel, breakdown } = data;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const hasBreakdown = (breakdown?.length ?? 0) > 0;

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

      {/* Bubble chart card */}
      <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-6">
        {/* Card header with optional toggle */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest">
              Output Expansion — by person
            </p>
            <p className="text-body-small text-m-on-surface-variant/60 mt-1">
              Inner circle = human hours · Middle ring = AI session hours · Outer ring = effective
              output (human × multiplier)
            </p>
          </div>
          {hasBreakdown && (
            <div className="flex gap-0.5 rounded-lg border border-m-outline-variant bg-m-surface p-0.5 shrink-0 ml-4 mt-0.5">
              <button
                onClick={() => setShowBreakdown(false)}
                className={[
                  "rounded-md px-3 py-1 text-label-small transition-colors",
                  !showBreakdown
                    ? "bg-m-primary/15 text-m-primary"
                    : "text-m-on-surface-variant hover:text-m-on-surface",
                ].join(" ")}
              >
                Summary
              </button>
              <button
                onClick={() => setShowBreakdown(true)}
                className={[
                  "rounded-md px-3 py-1 text-label-small transition-colors",
                  showBreakdown
                    ? "bg-m-primary/15 text-m-primary"
                    : "text-m-on-surface-variant hover:text-m-on-surface",
                ].join(" ")}
              >
                {BREAKDOWN_LABEL[period]}
              </button>
            </div>
          )}
        </div>

        {members.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant/40 text-center py-12">
            No sessions logged for this period. Use /log to record your first session.
          </p>
        ) : showBreakdown && hasBreakdown ? (
          <BreakdownChart breakdown={breakdown!} />
        ) : (
          <SummaryChart members={members} />
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

// ─── Summary chart (existing one-bubble-per-person layout) ───────────────────

function SummaryChart({ members }: { members: DirectData["members"] }) {
  return (
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
              <circle
                cx={cx} cy={cy} r={outerR}
                fill={`${color}12`} stroke={`${color}33`}
                strokeWidth={1.5} strokeDasharray="4 3"
              />
              <circle
                cx={cx} cy={cy} r={middleR}
                fill={`${color}1f`} stroke={`${color}4d`} strokeWidth={1}
              />
              <circle
                cx={cx} cy={cy} r={innerR}
                fill={`${color}b3`} stroke={color} strokeWidth={2}
              />
              <text x={cx} y={cy - 4} textAnchor="middle" fill={color}
                fontSize={16} fontWeight={800} fontFamily="Inter, sans-serif">
                {member.multiplier.toFixed(1)}×
              </text>
              <text x={cx} y={cy + 13} textAnchor="middle" fill={`${color}99`}
                fontSize={9} fontFamily="Inter, sans-serif">
                multiplier
              </text>
            </svg>
            <p className="text-label-large text-m-on-surface">{member.display_name}</p>
            <p className="text-body-small text-m-on-surface-variant">
              {member.human_hours.toFixed(1)}h human · {member.ai_session_hours.toFixed(1)}h AI
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Breakdown chart (one column per sub-period) ─────────────────────────────

function BreakdownChart({ breakdown }: { breakdown: BreakdownSlice[] }) {
  const allEmails = [...new Set(breakdown.flatMap((s) => s.members.map((m) => m.email)))];
  const colorByEmail = new Map(
    allEmails.map((email, i) => [email, MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );
  const multiMember = allEmails.length > 1;
  const BUBBLE = 120;

  return (
    <div className="overflow-x-auto -mx-1 px-1 py-4">
      <div className="flex gap-5" style={{ minWidth: "max-content" }}>
        {breakdown.map((slice) => (
          <div key={slice.sub_key} className="flex flex-col items-center gap-2">
            <p className="text-label-small text-m-on-surface-variant uppercase tracking-widest">
              {slice.sub_label}
            </p>
            {slice.members.map((member) => {
              const color = colorByEmail.get(member.email) ?? MEMBER_COLORS[0];
              const { innerR, middleR, outerR } = computeBubbleRadii(
                member.human_hours,
                member.ai_session_hours,
                member.multiplier,
              );
              return (
                <div key={member.email} className="flex flex-col items-center gap-1">
                  {/* viewBox stays 200×200; width/height scales the SVG down */}
                  <svg width={BUBBLE} height={BUBBLE} viewBox="0 0 200 200">
                    <circle
                      cx={100} cy={100} r={outerR}
                      fill={`${color}12`} stroke={`${color}33`}
                      strokeWidth={1.5} strokeDasharray="4 3"
                    />
                    <circle
                      cx={100} cy={100} r={middleR}
                      fill={`${color}1f`} stroke={`${color}4d`} strokeWidth={1}
                    />
                    <circle
                      cx={100} cy={100} r={innerR}
                      fill={`${color}b3`} stroke={color} strokeWidth={2}
                    />
                    <text x={100} y={96} textAnchor="middle" fill={color}
                      fontSize={16} fontWeight={800} fontFamily="Inter, sans-serif">
                      {member.multiplier.toFixed(1)}×
                    </text>
                    <text x={100} y={113} textAnchor="middle" fill={`${color}99`}
                      fontSize={9} fontFamily="Inter, sans-serif">
                      multiplier
                    </text>
                  </svg>
                  {multiMember && (
                    <p className="text-label-small text-m-on-surface">{member.display_name}</p>
                  )}
                  <p className="text-body-small text-m-on-surface-variant/70 text-center">
                    {member.human_hours.toFixed(1)}h · {member.multiplier.toFixed(1)}×
                  </p>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared subcomponents ─────────────────────────────────────────────────────

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
