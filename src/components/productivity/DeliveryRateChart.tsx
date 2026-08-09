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
  fontFamily: "var(--font-mono)",
};

export function DeliveryRateChart({ data, members, selectedUserId }: Props) {
  // Only members linked to ClickUp have a clickup_user_id — everyone else
  // has no time-tracked data to chart here.
  const membersWithClickUp = members.filter(
    (m): m is TeamMember & { clickup_user_id: number } => m.clickup_user_id !== null,
  );
  const visibleMembers = selectedUserId
    ? membersWithClickUp.filter((m) => m.clickup_user_id === selectedUserId)
    : membersWithClickUp;

  const memberColorMap = Object.fromEntries(
    membersWithClickUp.map((m, i) => [m.clickup_user_id, MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );

  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Tasks Completed — External vs Internal
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, key) => {
              const keyStr = String(key);
              const isInt = keyStr.endsWith("_int");
              const userId = isInt ? keyStr.slice(0, -4) : keyStr;
              const member = members.find((m) => String(m.clickup_user_id) === userId);
              const firstName = member?.full_name?.split(" ")[0] ?? userId;
              return [value, `${firstName} (${isInt ? "internal" : "external"})`];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => {
              const member = members.find((m) => String(m.clickup_user_id) === value);
              return member?.full_name?.split(" ")[0] ?? value;
            }}
          />
          {visibleMembers.map((m) => {
            const color = memberColorMap[m.clickup_user_id] ?? "#7C3AED";
            const stackId = String(m.clickup_user_id);
            return [
              <Bar
                key={`${m.clickup_user_id}_ext`}
                dataKey={`${m.clickup_user_id}_ext`}
                name={String(m.clickup_user_id)}
                stackId={stackId}
                fill={color}
                radius={[0, 0, 0, 0]}
              />,
              <Bar
                key={`${m.clickup_user_id}_int`}
                dataKey={`${m.clickup_user_id}_int`}
                name={`${m.clickup_user_id}_int`}
                stackId={stackId}
                fill={color}
                radius={[3, 3, 0, 0]}
                legendType="none"
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
