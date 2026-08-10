// src/components/productivity/SprintPointsChart.tsx
import {
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TeamMember } from "@/hooks/useTeam";
import {
  visibleMembers,
  memberColorMap,
  TOOLTIP_STYLE_BORDERED,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_ITEM_STYLE,
} from "./chartShared";

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  goalPoints: number;
  selectedUserId: number | null;
}

export function SprintPointsChart({ data, members, goalPoints, selectedUserId }: Props) {
  const displayMembers = visibleMembers(members, selectedUserId);
  const memberColor = memberColorMap(members);

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Output</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Sprint Points</p>
      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 56, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b", fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE_BORDERED}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            <ReferenceLine
              y={goalPoints}
              stroke="#f59e0b"
              strokeDasharray="5 3"
              label={{ value: `Goal ${goalPoints}`, position: "right", fill: "#f59e0b", fontSize: 10 }}
            />
            {displayMembers.map((member) => {
              const color = memberColor[member.clickup_user_id] ?? "#7C3AED";
              // userId in SprintPoint = the ClickUp numeric ID, which matches team_members.clickup_user_id
              const uid = String(member.clickup_user_id);
              return [
                <Bar
                  key={`${member.id}_business`}
                  dataKey={`${uid}_business`}
                  name={member.full_name ?? undefined}
                  stackId={uid}
                  fill={color}
                  radius={[0, 0, 0, 0]}
                />,
                <Bar
                  key={`${member.id}_self`}
                  dataKey={`${uid}_self`}
                  name={`${member.full_name} (self-created)`}
                  stackId={uid}
                  fill={color}
                  fillOpacity={0.45}
                  radius={[4, 4, 0, 0]}
                  legendType="none"
                >
                  <LabelList
                    dataKey={`${uid}_total`}
                    position="top"
                    style={{ fontSize: 10, fill: color, fontWeight: 600, fontFamily: "var(--font-mono)" }}
                    formatter={(v) => (Number(v) > 0 ? v : "")}
                  />
                </Bar>,
              ];
            })}
            {displayMembers.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(value) => (
                  <span style={{ color: "#94a3b8" }}>{value}</span>
                )}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
