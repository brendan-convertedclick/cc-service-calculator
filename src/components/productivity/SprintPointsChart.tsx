// src/components/productivity/SprintPointsChart.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { MEMBER_COLORS } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  goalPoints: number;
  selectedUserId: number | null;
}

export function SprintPointsChart({ data, members, goalPoints, selectedUserId }: Props) {
  const activeMembersWithClickUp = members.filter((m) => m.clickup_user_id !== null);

  const displayMembers =
    selectedUserId !== null
      ? activeMembersWithClickUp.filter((m) => m.clickup_user_id === selectedUserId)
      : activeMembersWithClickUp;

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Output</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Sprint Points</p>
      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1e2433",
                border: "1px solid #2d3748",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#e2e8f0", marginBottom: 4 }}
              itemStyle={{ color: "#94a3b8" }}
            />
            <ReferenceLine
              y={goalPoints}
              stroke="#f59e0b"
              strokeDasharray="5 3"
              label={{ value: `Goal ${goalPoints}`, position: "right", fill: "#f59e0b", fontSize: 10 }}
            />
            {displayMembers.map((member, idx) => {
              const originalIdx = activeMembersWithClickUp.findIndex(
                (m) => m.id === member.id,
              );
              const color = MEMBER_COLORS[originalIdx % MEMBER_COLORS.length];
              const isLast = idx === displayMembers.length - 1;
              return [
                <Bar
                  key={`${member.id}_business`}
                  dataKey={`${member.clickup_user_id}_business`}
                  name={member.full_name ?? undefined}
                  stackId="a"
                  fill={color}
                  radius={[0, 0, 0, 0]}
                />,
                <Bar
                  key={`${member.id}_self`}
                  dataKey={`${member.clickup_user_id}_self`}
                  name={`${member.full_name} (self-created)`}
                  stackId="a"
                  fill={color}
                  fillOpacity={0.45}
                  radius={isLast ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                  legendType="none"
                />,
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
