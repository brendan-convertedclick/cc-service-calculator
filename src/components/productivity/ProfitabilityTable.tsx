import { useState } from "react";
import type { ProjectProfitabilityRow } from "@/hooks/useProjectProfitability";
import { formatZar } from "@/lib/utils";

interface Props {
  rows: ProjectProfitabilityRow[];
}

const ragConfig = {
  green: { bg: "#14532d", text: "#4ade80", label: "On Track" },
  amber: { bg: "#713f12", text: "#facc15", label: "At Risk" },
  red: { bg: "#7f1d1d", text: "#f87171", label: "Off Track" },
} as const;

export function ProfitabilityTable({ rows }: Props) {
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  function toggleSort() {
    setDir((d) => (d === "desc" ? "asc" : "desc"));
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a.marginPct ?? -Infinity;
    const bv = b.marginPct ?? -Infinity;
    return dir === "desc" ? bv - av : av - bv;
  });

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface overflow-hidden">
      <table className="w-full text-body-medium">
        <thead>
          <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant uppercase tracking-wide">
            <th className="px-4 py-3 text-left font-medium">Project</th>
            <th className="px-4 py-3 text-left font-medium">Client</th>
            <th className="px-4 py-3 text-right font-medium">Quoted</th>
            <th className="px-4 py-3 text-right font-medium">Cost</th>
            <th
              className="px-4 py-3 text-right font-medium cursor-pointer select-none hover:text-m-on-surface transition-colors"
              onClick={toggleSort}
            >
              Margin {dir === "desc" ? "↓" : "↑"}
            </th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-m-on-surface-variant"
              >
                No projects found for this period.
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const rag = ragConfig[row.rag];
              return (
                <tr
                  key={row.projectId}
                  className="border-t border-m-outline-variant text-m-on-surface hover:bg-m-surface-container transition-colors"
                >
                  <td className="px-4 py-3">{row.projectName}</td>
                  <td className="px-4 py-3 text-m-on-surface-variant">
                    {row.clientName}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatZar(row.quotedCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatZar(row.costCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {row.marginPct != null
                      ? `${row.marginPct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-label-medium font-medium"
                      style={{ backgroundColor: rag.bg, color: rag.text }}
                    >
                      {rag.label}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
