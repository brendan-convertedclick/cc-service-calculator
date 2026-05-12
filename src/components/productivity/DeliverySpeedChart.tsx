import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";

interface SpeedRow {
  bucket: string;
  totalCompleted: number;
  avgCycleDays: number;
}

interface Props {
  data: SpeedRow[];
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};

export function DeliverySpeedChart({ data }: Props) {
  return (
    <div className="rounded-xl bg-m-surface-container p-5">
      <p className="text-label-medium text-m-on-surface-variant mb-4">
        Throughput &amp; Cycle Time
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} barCategoryGap="40%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="left"
            orientation="left"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            label={{ value: "tasks", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748b" }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            label={{ value: "days", angle: 90, position: "insideRight", fontSize: 10, fill: "#64748b" }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) =>
              name === "totalCompleted" ? [`${value} tasks`, "Completed"] : [`${value}d`, "Avg Cycle"]
            }
          />
          <Bar yAxisId="left" dataKey="totalCompleted" fill="#7C3AED" radius={[3, 3, 0, 0]} name="totalCompleted" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgCycleDays"
            stroke="#EC4899"
            strokeWidth={2}
            dot={{ r: 3, fill: "#EC4899" }}
            name="avgCycleDays"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-body-small text-m-on-surface-variant mt-2">
        Bars = tasks completed · Pink line = avg days from created → done
      </p>
    </div>
  );
}
