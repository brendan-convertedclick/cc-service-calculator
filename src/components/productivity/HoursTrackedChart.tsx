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
  selectedUserId: number | null;
}

export function HoursTrackedChart({ data, members, selectedUserId }: Props) {
  const displayMembers = visibleMembers(members, selectedUserId);
  const memberColor = memberColorMap(members);

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
              tick={{ fontSize: 10, fill: "#64748b", fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE_BORDERED}
              labelStyle={TOOLTIP_LABEL_STYLE}
              formatter={(value) => [`${Number(value).toFixed(1)} hrs`]}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            {displayMembers.map((member) => {
              const color = memberColor[member.clickup_user_id] ?? "#7C3AED";
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
                    style={{ fontSize: 10, fill: color, fontWeight: 600, fontFamily: "var(--font-mono)" }}
                    formatter={(v) => (Number(v) > 0 ? `${v}h` : "")}
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
