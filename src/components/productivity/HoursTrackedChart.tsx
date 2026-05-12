import {
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { MEMBER_COLORS } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  selectedUserId: number | null;
}

export function HoursTrackedChart({ data, members, selectedUserId }: Props) {
  const activeMembersWithClickUp = members.filter((m) => m.clickup_user_id !== null);

  const displayMembers =
    selectedUserId !== null
      ? activeMembersWithClickUp.filter((m) => m.clickup_user_id === selectedUserId)
      : activeMembersWithClickUp;

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Effort</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Hours Tracked</p>
      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 16, left: -20, bottom: 0 }}>
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
              formatter={(value: number) => [`${value.toFixed(1)} hrs`]}
              itemStyle={{ color: "#94a3b8" }}
            />
            {displayMembers.map((member) => {
              const originalIdx = activeMembersWithClickUp.findIndex(
                (m) => m.id === member.id,
              );
              const color = MEMBER_COLORS[originalIdx % MEMBER_COLORS.length];
              const uid = String(member.clickup_user_id);
              return (
                <Bar
                  key={member.id}
                  dataKey={`${uid}_hours`}
                  name={member.full_name ?? undefined}
                  fill={color}
                  fillOpacity={0.85}
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey={`${uid}_hours`}
                    position="top"
                    style={{ fontSize: 10, fill: color, fontWeight: 600 }}
                    formatter={(v: number) => (v > 0 ? `${v}h` : "")}
                  />
                </Bar>
              );
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
