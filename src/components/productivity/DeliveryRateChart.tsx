import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import type { TeamMember } from "@/hooks/useTeam";
import { MEMBER_COLORS } from "@/hooks/useProductivity";

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  selectedUserId: number | null;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

export function DeliveryRateChart({ data, members, selectedUserId }: Props) {
  const visibleMembers = selectedUserId
    ? members.filter((m) => m.clickup_user_id === selectedUserId)
    : members;

  const memberColorMap = Object.fromEntries(
    members.map((m, i) => [m.clickup_user_id, MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );

  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Tasks Completed — External vs Internal
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="28%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => {
              const [userId, type] = value.split("_");
              const member = members.find((m) => String(m.clickup_user_id) === userId);
              const label = member?.full_name?.split(" ")[0] ?? userId;
              return `${label} (${type === "ext" ? "external" : "internal"})`;
            }}
          />
          {visibleMembers.map((m) => {
            const color = memberColorMap[m.clickup_user_id] ?? "#7C3AED";
            return [
              <Bar
                key={`${m.clickup_user_id}_ext`}
                dataKey={`${m.clickup_user_id}_ext`}
                name={`${m.clickup_user_id}_ext`}
                fill={color}
                radius={[3, 3, 0, 0]}
              />,
              <Bar
                key={`${m.clickup_user_id}_int`}
                dataKey={`${m.clickup_user_id}_int`}
                name={`${m.clickup_user_id}_int`}
                fill={color}
                opacity={0.4}
                radius={[3, 3, 0, 0]}
              />,
            ];
          })}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Solid = external (client) · Faded = internal
      </p>
    </div>
  );
}
