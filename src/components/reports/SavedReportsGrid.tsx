// src/components/reports/SavedReportsGrid.tsx
//
// Saved reports shown as clickable cards on the Reports homepage, so your saved
// views are visible at a glance (not tucked behind the Saved dropdown). Click a
// card to open that client + period; trash to delete.

import { Bookmark, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSavedReports, useDeleteReport } from "@/hooks/useSavedReports";
import { reportTypeDef, type ReportType } from "@/lib/report-types";

interface SavedReportsGridProps {
  activeClientId?: string;
  activeStart?: string;
  activeEnd?: string;
  activeType?: ReportType;
  onLoad: (clientId: string, from: string, to: string, type: ReportType) => void;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
function fmt(dateStr: string, withYear = false): string {
  return (withYear ? DAY_MONTH_YEAR : DAY_MONTH).format(new Date(`${dateStr}T00:00:00`));
}

export function SavedReportsGrid({
  activeClientId,
  activeStart,
  activeEnd,
  activeType,
  onLoad,
}: SavedReportsGridProps) {
  const { data: reports = [], isLoading } = useSavedReports();
  const deleteReport = useDeleteReport();

  if (isLoading || reports.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Bookmark className="h-4 w-4 text-m-on-surface-variant" />
        <h2 className="text-title-medium">Saved reports</h2>
        <span className="text-label-small text-m-on-surface-variant">({reports.length})</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const active =
            r.client_id === activeClientId &&
            r.period_start === activeStart &&
            r.period_end === activeEnd &&
            r.report_type === activeType;
          return (
            <Card
              key={r.id}
              onClick={() => onLoad(r.client_id, r.period_start, r.period_end, r.report_type)}
              className={`group relative cursor-pointer p-4 transition-shadow hover:shadow-elev-2 ${
                active ? "ring-2 ring-m-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Badge variant="secondary" className="mb-1.5 text-label-small">
                    {reportTypeDef(r.report_type)?.short ?? "Report"}
                  </Badge>
                  <h3 className="truncate text-title-small text-m-on-surface">{r.name}</h3>
                  <p className="mt-0.5 truncate text-body-small text-m-on-surface-variant">
                    {r.client_name ?? "—"}
                  </p>
                  <p className="mt-1 text-label-small tabular-nums text-m-on-surface-variant">
                    {fmt(r.period_start)} – {fmt(r.period_end, true)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-m-on-surface-variant opacity-0 transition-opacity hover:text-m-error group-hover:opacity-100"
                  aria-label={`Delete ${r.name}`}
                  disabled={deleteReport.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteReport.mutate(r.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
