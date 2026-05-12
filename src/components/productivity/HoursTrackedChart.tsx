import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { bucket: string; hours: number }[];
}

export function HoursTrackedChart({ data }: Props) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      <p className="text-label-small uppercase tracking-widest text-m-on-surface-variant">Effort</p>
      <p className="mt-0.5 text-title-medium font-semibold text-m-on-surface">Hours Tracked</p>
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
              formatter={(value: number) => [`${value.toFixed(1)} hrs`, "Hours"]}
              itemStyle={{ color: "#94a3b8" }}
            />
            <Bar
              dataKey="hours"
              name="Hours"
              fill="#3b82f6"
              fillOpacity={0.8}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
