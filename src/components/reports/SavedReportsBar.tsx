// src/components/reports/SavedReportsBar.tsx
//
// Named saved views for the Reports page. A saved report stores the selected
// client + billing period under a name; loading one applies those to the page
// (via the URL params). Save the current view, pick a saved one to jump to it,
// or delete ones you no longer need.

import { useEffect, useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSavedReports, useSaveReport, useDeleteReport } from "@/hooks/useSavedReports";
import { reportTypeDef, type ReportType } from "@/lib/report-types";

interface SavedReportsBarProps {
  clientId: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  clientLabel: string;
  reportType: ReportType;
  createdBy: string | null;
  /** Apply a saved report to the page. */
  onLoad: (clientId: string, from: string, to: string, type: ReportType) => void;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
function fmt(dateStr: string): string {
  return DAY_MONTH.format(new Date(`${dateStr}T00:00:00`));
}

export function SavedReportsBar({
  clientId,
  startDate,
  endDate,
  clientLabel,
  reportType,
  createdBy,
  onLoad,
}: SavedReportsBarProps) {
  const { data: reports = [], isLoading } = useSavedReports();
  const saveReport = useSaveReport();
  const deleteReport = useDeleteReport();

  const [listOpen, setListOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  // Suggest a sensible name when the dialog opens.
  useEffect(() => {
    if (saveOpen) setName(`${clientLabel} · ${fmt(startDate)}–${fmt(endDate)}`);
  }, [saveOpen, clientLabel, startDate, endDate]);

  const handleSave = async () => {
    if (!clientId) {
      toast.error("Pick a client first");
      return;
    }
    if (!name.trim()) {
      toast.error("Give the report a name");
      return;
    }
    try {
      await saveReport.mutateAsync({
        name: name.trim(),
        client_id: clientId,
        period_start: startDate,
        period_end: endDate,
        report_type: reportType,
        created_by: createdBy,
      });
      toast.success("Report saved");
      setSaveOpen(false);
    } catch (e) {
      toast.error(`Couldn’t save report: ${errorMessage(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-label-small text-m-on-surface-variant">Saved reports</label>
      <div className="flex items-center gap-2">
        <Popover open={listOpen} onOpenChange={setListOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Bookmark className="h-4 w-4" />
              Saved
              {reports.length > 0 && (
                <span className="rounded-md bg-m-surface-container-high px-1.5 text-label-small tabular-nums">
                  {reports.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            {isLoading ? (
              <p className="p-4 text-body-small text-m-on-surface-variant">Loading…</p>
            ) : reports.length === 0 ? (
              <p className="p-4 text-body-small text-m-on-surface-variant">
                No saved reports yet. Set a client + period, then “Save current view”.
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {reports.map((r) => {
                  const active =
                    r.client_id === clientId &&
                    r.period_start === startDate &&
                    r.period_end === endDate &&
                    r.report_type === reportType;
                  return (
                    <li key={r.id} className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => {
                          onLoad(r.client_id, r.period_start, r.period_end, r.report_type);
                          setListOpen(false);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-m-surface-container-high"
                      >
                        <Check
                          className={`h-4 w-4 shrink-0 ${active ? "text-m-primary" : "text-transparent"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-small text-m-on-surface">
                            {r.name}
                          </span>
                          <span className="block truncate text-label-small text-m-on-surface-variant">
                            {reportTypeDef(r.report_type)?.short ?? "Report"} · {r.client_name ?? "—"} ·{" "}
                            {fmt(r.period_start)}–{fmt(r.period_end)}
                          </span>
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-m-on-surface-variant hover:text-m-error"
                        aria-label={`Delete ${r.name}`}
                        disabled={deleteReport.isPending}
                        onClick={() => deleteReport.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>

        <Button variant="ghost" disabled={!clientId} onClick={() => setSaveOpen(true)}>
          Save current view
        </Button>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save report</DialogTitle>
            <DialogDescription>
              Saves this client and billing period under a name. Anyone on the team can load it
              from the Saved list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="report-name" className="text-label-large text-m-on-surface">
              Name
            </label>
            <Input
              id="report-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="e.g. Dovetail — August"
            />
            <p className="text-label-small text-m-on-surface-variant">
              {clientLabel} · {fmt(startDate)} – {fmt(endDate)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveReport.isPending}>
              {saveReport.isPending ? "Saving…" : "Save report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
