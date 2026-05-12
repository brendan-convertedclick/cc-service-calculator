// src/components/productivity/PointModificationsTable.tsx
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PointModification } from "@/hooks/useProductivity";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface Props {
  modifications: PointModification[];
  members: TeamMember[];
}

export function PointModificationsTable({ modifications, members }: Props) {
  const [open, setOpen] = useState(modifications.length > 0);

  const sorted = [...modifications].sort(
    (a, b) => Number(a.changedAt) - Number(b.changedAt),
  );

  function getMemberName(userId: number): string {
    const member = members.find((m) => m.clickup_user_id === userId);
    return member?.name ?? String(userId);
  }

  function formatDate(changedAt: string): string {
    return new Date(Number(changedAt)).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
    });
  }

  function truncateTask(name: string): string {
    return name.length > 40 ? name.slice(0, 40) + "…" : name;
  }

  function deltaColor(delta: number): string {
    if (delta > 0) return "text-red-400";
    if (delta < 0) return "text-emerald-400";
    return "text-m-on-surface-variant";
  }

  function deltaLabel(delta: number): string {
    return delta >= 0 ? `+${delta} pts` : `${delta} pts`;
  }

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface-container p-5">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between"
      >
        <span className="flex items-center text-title-small font-semibold text-m-on-surface">
          Sprint Point Changes
          {modifications.length > 0 && (
            <span className="ml-2 rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-400">
              {modifications.length} change{modifications.length !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-m-on-surface-variant" />
        ) : (
          <ChevronDown className="h-4 w-4 text-m-on-surface-variant" />
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="mt-4">
          {modifications.length === 0 ? (
            <p className="text-center text-body-small text-m-on-surface-variant">
              No sprint point changes detected for this period.
            </p>
          ) : (
            <table className="w-full text-body-small">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-m-on-surface-variant">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-left font-medium">Task</th>
                  <th className="pb-2 text-left font-medium">Member</th>
                  <th className="pb-2 text-left font-medium">Before → After</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry, i) => {
                  const delta = entry.newPoints - entry.oldPoints;
                  return (
                    <tr
                      key={`${entry.taskId}-${entry.changedAt}-${i}`}
                      className="border-t border-m-outline-variant text-m-on-surface"
                    >
                      <td className="py-2 pr-4 tabular-nums">
                        {formatDate(entry.changedAt)}
                      </td>
                      <td className="py-2 pr-4" title={entry.taskName}>
                        {truncateTask(entry.taskName)}
                      </td>
                      <td className="py-2 pr-4">
                        {getMemberName(entry.userId)}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {entry.oldPoints} pts → {entry.newPoints} pts
                      </td>
                      <td className={`py-2 text-right tabular-nums font-medium ${deltaColor(delta)}`}>
                        {deltaLabel(delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
