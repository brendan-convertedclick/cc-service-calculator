import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import type { TeamMember } from "@/hooks/useTeam";
import { TOOLTIP_STYLE, visibleMembers, memberColorMap } from "./chartShared";

interface Props {
  data: Record<string, number | string>[];
  members: TeamMember[];
  selectedUserId: number | null;
}

function formatZarTick(value: number): string {
  if (value >= 1000) return `R${(value / 1000).toFixed(0)}K`;
  return `R${value}`;
}

export function DeliveryValueChart({ data, members, selectedUserId }: Props) {
  const visible = visibleMembers(members, selectedUserId);
  const memberColor = memberColorMap(members);

  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Delivery Yield — Value (ZAR) per Period
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="28%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={formatZarTick}
            tick={{ fontSize: 11, fill: "#94a3b8", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => {
              const userId = String(name).replace("_value", "");
              const member = members.find((m) => String(m.clickup_user_id) === userId);
              const label = member?.full_name?.split(" ")[0] ?? userId;
              return [`R ${Number(value).toLocaleString()}`, label];
            }}
          />
          {visible.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => {
                const userId = value.replace("_value", "");
                const member = members.find((m) => String(m.clickup_user_id) === userId);
                return member?.full_name?.split(" ")[0] ?? userId;
              }}
            />
          )}
          {visible.map((m) => (
            <Bar
              key={`${m.clickup_user_id}_value`}
              dataKey={`${m.clickup_user_id}_value`}
              name={`${m.clickup_user_id}_value`}
              fill={memberColor[m.clickup_user_id] ?? "#7C3AED"}
              radius={[3, 3, 0, 0]}
              stackId="value"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Based on sprint points × R/pt — set in Settings
      </p>
    </div>
  );
}
