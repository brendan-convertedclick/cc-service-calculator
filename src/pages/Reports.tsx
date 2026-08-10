// src/pages/Reports.tsx
//
// Per-client invoice run on a 20th → 20th billing cycle. Pulls completed,
// un-invoiced work from get-invoice-report:
//   - Ad hoc quick-task briefs (completion live from ClickUp) as one list.
//   - Each fixed project as its own report card.
// Marking a line/project invoiced stamps invoiced_at so it drops out of
// future runs; an inline Undo covers accidental clicks.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Gauge, Hourglass, Undo2 } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { toggleInSet } from "@/lib/utils";
import { toISODate } from "@/lib/dates";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeliveryScorecard } from "@/components/reports/DeliveryScorecard";
import { SavedReportsBar } from "@/components/reports/SavedReportsBar";
import { SavedReportsGrid } from "@/components/reports/SavedReportsGrid";
import { DelayTrendReport } from "@/components/reports/DelayTrendReport";
import { useClientDeliveryScorecard } from "@/hooks/useClientDeliveryScorecard";
import { REPORT_TYPES, isReportType, reportTypeDef, type ReportType } from "@/lib/report-types";

const TYPE_ICON: Record<ReportType, typeof FileText> = {
  invoice: FileText,
  scorecard: Gauge,
  delays: Hourglass,
};

type AdhocItem = {
  brief_id: string;
  name: string;
  clickup_task_url: string | null;
  completed_at: string;
  hours: number;
  amount_cents: number | null;
  carried_over: boolean;
};

type ProjectTask = {
  name: string;
  hours: number;
  closed_at: string;
  carried_over: boolean;
};

type ProjectReport = {
  project_id: string;
  name: string;
  quote_total_cents: number | null;
  completed_at: string | null;
  status: string;
  tasks: ProjectTask[];
  hours_total: number;
  open_task_count: number;
};

type Report = {
  adhoc: { items: AdhocItem[]; open_count: number };
  projects: ProjectReport[];
  warnings: string[];
};

/** The billing cycle ending on the most recent 20th (end exclusive). */
function defaultCycleEnd(today: Date): Date {
  return today.getDate() >= 20
    ? new Date(today.getFullYear(), today.getMonth(), 20)
    : new Date(today.getFullYear(), today.getMonth() - 1, 20);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local Date → "YYYY-MM-DD" for a native date input (no UTC shift). */
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DD" → local midnight Date, matching the old cycle construction. */
function parseDateInput(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDate(iso: string): string {
  return DAY_MONTH_YEAR.format(new Date(iso));
}

/** Serialise rows to CSV (Excel opens it natively) and trigger a download. */
function downloadCsv(rows: Record<string, string | number>[], filename: string) {
  const csv = Papa.unparse(rows);
  // Prepend a UTF-8 BOM so Excel renders the R currency symbol correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { currentUserId } = useAuth();
  const queryClient = useQueryClient();

  // The whole view (client + billing window) lives in the URL so it's
  // bookmarkable and shareable — "save this view" = bookmark the page.
  // Missing params fall back to the most recent complete 20th→20th cycle.
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => {
    const end = defaultCycleEnd(new Date());
    const start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate());
    return { from: toDateInput(start), to: toDateInput(end) };
  }, []);
  const clientId = searchParams.get("client") ?? "";
  const startDate = searchParams.get("from") ?? defaults.from; // end exclusive
  const endDate = searchParams.get("to") ?? defaults.to;

  const patchParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearchParams(next, { replace: true });
  };
  const setClientId = (id: string) => patchParams({ client: id });
  const setStartDate = (s: string) => patchParams({ from: s });
  const setEndDate = (s: string) => patchParams({ to: s });

  // Which of the three report views is active (null = the landing chooser).
  const reportType = searchParams.get("type");
  const activeType = isReportType(reportType) ? reportType : null;
  const setType = (t: ReportType | null) => patchParams({ type: t ?? "" });
  const loadSaved = (client: string, from: string, to: string, t: ReportType) =>
    patchParams({ client, from, to, type: t });
  const [justMarked, setJustMarked] = useState<
    { kind: "briefs" | "project"; ids: string[]; label: string }[]
  >([]);
  // Rows ticked for export. Ad hoc keyed by brief_id; project tasks by
  // `${project_id}:${taskIndex}`.
  const [selectedAdhoc, setSelectedAdhoc] = useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  // Selections reference this client+cycle's rows — drop them when either
  // changes so a stale tick can never leak into another client's export.
  useEffect(() => {
    setSelectedAdhoc(new Set());
    setSelectedTasks(new Set());
  }, [clientId, startDate, endDate]);

  const cycle = useMemo(
    () => ({ start: parseDateInput(startDate), end: parseDateInput(endDate) }),
    [startDate, endDate],
  );
  const cycleValid = cycle.start < cycle.end;
  const cycleInProgress = cycle.end > new Date();

  const { data: clients } = useQuery({
    queryKey: ["clients-for-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, short_name")
        .is("archived_at", null)
        .order("short_name");
      if (error) throw error;
      return data;
    },
  });

  const report = useQuery<Report>({
    queryKey: [
      "invoice-report",
      clientId,
      cycle.start.toISOString(),
      cycle.end.toISOString(),
    ],
    enabled: !!clientId && cycleValid && activeType === "invoice",
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-invoice-report", {
        body: {
          client_id: clientId,
          period_start: cycle.start.toISOString(),
          period_end: cycle.end.toISOString(),
        },
      });
      if (error) throw error;
      return data as Report;
    },
  });

  // Same query key as the DeliveryScorecard card → shared cache, no extra fetch.
  const scorecard = useClientDeliveryScorecard(
    clientId,
    cycle.start.toISOString(),
    cycle.end.toISOString(),
  ).data;

  const refetchReport = () =>
    queryClient.invalidateQueries({ queryKey: ["invoice-report", clientId] });

  const markBriefs = useMutation({
    mutationFn: async ({ ids, undo }: { ids: string[]; label: string; undo?: boolean }) => {
      const { error } = await supabase
        .from("briefs")
        .update(
          undo
            ? { invoiced_at: null, invoiced_by: null }
            : { invoiced_at: new Date().toISOString(), invoiced_by: currentUserId },
        )
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      setJustMarked((prev) =>
        vars.undo
          ? prev.filter((m) => m.ids.join() !== vars.ids.join())
          : [...prev, { kind: "briefs", ids: vars.ids, label: vars.label }],
      );
      refetchReport();
    },
  });

  const markProject = useMutation({
    mutationFn: async ({ id, undo }: { id: string; label: string; undo?: boolean }) => {
      const { error } = await supabase
        .from("projects")
        .update(
          undo
            ? { invoiced_at: null, invoiced_by: null }
            : { invoiced_at: new Date().toISOString(), invoiced_by: currentUserId },
        )
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      setJustMarked((prev) =>
        vars.undo
          ? prev.filter((m) => m.ids[0] !== vars.id)
          : [...prev, { kind: "project", ids: [vars.id], label: vars.label }],
      );
      refetchReport();
    },
  });

  const adhoc = report.data?.adhoc;
  const adhocTotal = (adhoc?.items ?? []).reduce((s, i) => s + (i.amount_cents ?? 0), 0);
  const adhocHours = (adhoc?.items ?? []).reduce((s, i) => s + i.hours, 0);
  const busy = markBriefs.isPending || markProject.isPending;

  const adhocItems = adhoc?.items ?? [];
  const projects = report.data?.projects ?? [];
  const taskKey = (projectId: string, idx: number) => `${projectId}:${idx}`;

  const allAdhocSelected =
    adhocItems.length > 0 && adhocItems.every((i) => selectedAdhoc.has(i.brief_id));
  const projectAllSelected = (p: ProjectReport) =>
    p.tasks.length > 0 && p.tasks.every((_t, idx) => selectedTasks.has(taskKey(p.project_id, idx)));

  const toggleAdhoc = (id: string) => setSelectedAdhoc((prev) => toggleInSet(prev, id));
  const toggleTask = (key: string) => setSelectedTasks((prev) => toggleInSet(prev, key));
  const setAllAdhoc = (on: boolean) =>
    setSelectedAdhoc(on ? new Set(adhocItems.map((i) => i.brief_id)) : new Set());
  const setAllProject = (p: ProjectReport, on: boolean) =>
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      p.tasks.forEach((_t, idx) => {
        const k = taskKey(p.project_id, idx);
        on ? next.add(k) : next.delete(k);
      });
      return next;
    });

  const selectedCount = selectedAdhoc.size + selectedTasks.size;
  const selectedAmount = adhocItems
    .filter((i) => selectedAdhoc.has(i.brief_id))
    .reduce((s, i) => s + (i.amount_cents ?? 0), 0);

  const client = (clients ?? []).find((c) => c.id === clientId);
  const clientLabel = client?.short_name ?? client?.name ?? "client";

  // Anything worth exporting on the page right now.
  const hasExportable =
    selectedCount > 0 ||
    adhocItems.length > 0 ||
    projects.some((p) => p.tasks.length > 0) ||
    (scorecard?.delivered ?? 0) > 0 ||
    (scorecard?.openCount ?? 0) > 0;

  // Export ticked invoice lines when any are selected; otherwise export the
  // whole page — delivery scorecard summary + open backlog + all invoice lines.
  const exportCsv = () => {
    const useSelection = selectedCount > 0;
    const blank = { Section: "", Item: "", Date: "", Status: "", Hours: "", "Amount (ZAR)": "" };
    const rows: Record<string, string | number>[] = [];

    if (!useSelection && scorecard) {
      const rate = scorecard.onTimeRate != null ? `${Math.round(scorecard.onTimeRate * 100)}%` : "—";
      const turn = scorecard.avgTurnaroundDays != null ? `${scorecard.avgTurnaroundDays}d` : "—";
      rows.push({
        ...blank,
        Section: "Scorecard",
        Item: `Delivered ${scorecard.delivered} · On time ${scorecard.onTime} · Late ${scorecard.late} · Over budget ${scorecard.overBudget} · ${rate} on time · Avg turnaround ${turn} · Open ${scorecard.openCount} (${scorecard.overdueOpenCount} overdue)`,
        Date: `${toISODate(cycle.start)} → ${toISODate(cycle.end)}`,
      });
      for (const t of scorecard.openTasks) {
        rows.push({
          ...blank,
          Section: "Open",
          Item: t.name,
          Date: t.original_due_date ?? "",
          Status: `${t.overdue ? "overdue · " : ""}${t.status_label ?? ""}`.trim(),
        });
      }
    }

    for (const i of adhocItems) {
      if (useSelection && !selectedAdhoc.has(i.brief_id)) continue;
      rows.push({
        ...blank,
        Section: "Ad hoc",
        Item: i.name,
        Date: formatDate(i.completed_at),
        Hours: i.hours.toFixed(2),
        "Amount (ZAR)": i.amount_cents !== null ? (i.amount_cents / 100).toFixed(2) : "",
      });
    }
    for (const p of projects) {
      p.tasks.forEach((t, idx) => {
        if (useSelection && !selectedTasks.has(taskKey(p.project_id, idx))) return;
        rows.push({
          ...blank,
          Section: p.name,
          Item: t.name,
          Date: formatDate(t.closed_at),
          Hours: t.hours.toFixed(2),
        });
      });
    }

    if (rows.length === 0) return;
    const cycleLabel = `${toISODate(cycle.start)}_${toISODate(cycle.end)}`;
    const safeClient = clientLabel.replace(/[^\w.-]+/g, "-");
    const kind = useSelection ? "invoice" : "report";
    downloadCsv(rows, `${safeClient}_${kind}_${cycleLabel}.csv`);
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-headline-small">Reports</h1>
        <p className="text-body-small text-m-on-surface-variant">
          {activeType
            ? reportTypeDef(activeType)?.description
            : "Choose a report type below, or open a saved report."}
        </p>
      </header>

      {activeType && (
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.id}
              type="button"
              onClick={() => setType(rt.id)}
              className={`rounded-md px-3 py-1 text-label-large transition-colors ${
                rt.id === activeType
                  ? "bg-m-primary text-m-on-primary"
                  : "bg-m-surface-container-high text-m-on-surface-variant hover:bg-m-surface-container-highest"
              }`}
            >
              {rt.short}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setType(null)}
            className="ml-1 text-label-small text-m-on-surface-variant hover:underline"
          >
            ← All reports
          </button>
        </div>
      )}

      {activeType && (
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-label-small text-m-on-surface-variant">Client</label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {(clients ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.short_name ?? c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-label-small text-m-on-surface-variant">Billing period</label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              aria-label="Period start date"
              className="w-[9.5rem] tabular-nums"
            />
            <span className="text-body-small text-m-on-surface-variant">–</span>
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => e.target.value && setEndDate(e.target.value)}
              aria-label="Period end date"
              className="w-[9.5rem] tabular-nums"
            />
            {cycleInProgress && cycleValid && (
              <span className="text-label-small text-m-on-surface-variant">(in progress)</span>
            )}
          </div>
          {!cycleValid && (
            <span className="text-label-small text-m-error">
              End date must be after the start date.
            </span>
          )}
        </div>

        <SavedReportsBar
          clientId={clientId}
          startDate={startDate}
          endDate={endDate}
          clientLabel={clientLabel}
          reportType={activeType}
          createdBy={currentUserId}
          onLoad={loadSaved}
        />

        {clientId && cycleValid && activeType !== "delays" && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-label-small text-m-on-surface-variant">
              {selectedCount > 0 ? (
                <>
                  {selectedCount} selected
                  {selectedAmount > 0 && (
                    <>
                      {" · "}
                      <Money cents={selectedAmount} />
                    </>
                  )}
                </>
              ) : (
                "exports full report"
              )}
            </span>
            <Button variant="outline" disabled={!hasExportable} onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        )}
      </div>
      )}

      {activeType === "invoice" && justMarked.map((m) => (
        <div
          key={m.kind + m.ids.join()}
          className="flex items-center justify-between gap-3 rounded-xl border border-m-outline-variant bg-m-surface-container-low px-4 py-2"
        >
          <span className="text-body-small text-m-on-surface-variant">
            Marked invoiced: {m.label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              m.kind === "briefs"
                ? markBriefs.mutate({ ids: m.ids, label: m.label, undo: true })
                : markProject.mutate({ id: m.ids[0], label: m.label, undo: true })
            }
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
          </Button>
        </div>
      ))}

      {/* ── Landing: choose a report type + saved reports ───────────────── */}
      {!activeType && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {REPORT_TYPES.map((rt) => {
              const Icon = TYPE_ICON[rt.id];
              return (
                <Card
                  key={rt.id}
                  onClick={() => setType(rt.id)}
                  className="cursor-pointer p-5 transition-shadow hover:shadow-elev-2"
                >
                  <Icon className="mb-3 h-6 w-6 text-m-primary" />
                  <h3 className="text-title-small text-m-on-surface">{rt.label}</h3>
                  <p className="mt-1 text-body-small text-m-on-surface-variant">{rt.description}</p>
                </Card>
              );
            })}
          </div>
          <SavedReportsGrid
            activeClientId={clientId}
            activeStart={startDate}
            activeEnd={endDate}
            activeType={activeType ?? undefined}
            onLoad={loadSaved}
          />
        </div>
      )}

      {/* ── A report type is active — need a client to build it ─────────── */}
      {activeType && !clientId && (
        <p className="text-body-medium text-m-on-surface-variant">
          Pick a client to build this report.
        </p>
      )}

      {activeType === "scorecard" && clientId && cycleValid && (
        <DeliveryScorecard
          clientId={clientId}
          cycleStartIso={cycle.start.toISOString()}
          cycleEndIso={cycle.end.toISOString()}
        />
      )}

      {activeType === "delays" && clientId && cycleValid && (
        <DelayTrendReport
          clientId={clientId}
          cycleStartIso={cycle.start.toISOString()}
          cycleEndIso={cycle.end.toISOString()}
        />
      )}

      {activeType === "invoice" && report.isLoading && (
        <p className="text-body-small text-m-on-surface-variant">Building report…</p>
      )}
      {activeType === "invoice" && report.error && (
        <p className="text-body-small text-m-error">{(report.error as Error).message}</p>
      )}

      {report.data && (
        <>
          {/* ── Ad hoc work ─────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2">
                {adhocItems.length > 0 && (
                  <Checkbox
                    checked={allAdhocSelected}
                    onCheckedChange={(v) => setAllAdhoc(v === true)}
                    aria-label="Select all ad hoc work"
                  />
                )}
                <h2 className="text-title-medium">Ad hoc work</h2>
              </label>
              {adhoc && adhoc.open_count > 0 && (
                <span className="text-label-small text-m-on-surface-variant">
                  {adhoc.open_count} adhoc task{adhoc.open_count !== 1 ? "s" : ""} still open
                  (not shown)
                </span>
              )}
            </div>
            <Card>
              <CardContent className="p-0">
                {(adhoc?.items ?? []).length === 0 ? (
                  <p className="p-6 text-center text-body-small text-m-on-surface-variant">
                    No completed, un-invoiced ad hoc work in this cycle.
                  </p>
                ) : (
                  <>
                    <ul className="divide-y divide-m-outline-variant">
                      {adhoc!.items.map((i) => (
                        <li key={i.brief_id} className="flex items-start gap-3 px-4 py-3">
                          <Checkbox
                            className="mt-1 shrink-0"
                            checked={selectedAdhoc.has(i.brief_id)}
                            onCheckedChange={() => toggleAdhoc(i.brief_id)}
                            aria-label={`Select ${i.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 break-words text-body-medium text-m-on-surface">
                                {i.name}
                              </span>
                              {i.carried_over && (
                                <Badge variant="warning" className="whitespace-nowrap">
                                  Carried over
                                </Badge>
                              )}
                              {i.clickup_task_url && (
                                <a
                                  href={i.clickup_task_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open ${i.name} in ClickUp`}
                                  className="text-m-primary hover:underline"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                            <p className="mt-0.5 text-label-small text-m-on-surface-variant">
                              Completed {formatDate(i.completed_at)}
                              {i.hours > 0 && ` · ${i.hours.toFixed(2)}h logged`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {i.amount_cents !== null ? (
                              <Money cents={i.amount_cents} className="text-body-medium font-semibold" />
                            ) : (
                              <span
                                className="text-body-small text-m-on-surface-variant"
                                title="No priced scope lines on this brief"
                              >
                                unpriced
                              </span>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={busy}
                            onClick={() =>
                              markBriefs.mutate({ ids: [i.brief_id], label: i.name })
                            }
                          >
                            Mark invoiced
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between gap-3 border-t border-m-outline-variant px-4 py-3">
                      <span className="text-body-small text-m-on-surface-variant">
                        {adhoc!.items.length} item{adhoc!.items.length !== 1 ? "s" : ""} ·{" "}
                        {adhocHours.toFixed(2)}h
                      </span>
                      <div className="flex items-center gap-3">
                        <Money cents={adhocTotal} className="text-title-small font-semibold" />
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            markBriefs.mutate({
                              ids: adhoc!.items.map((i) => i.brief_id),
                              label: `all ${adhoc!.items.length} ad hoc items`,
                            })
                          }
                        >
                          Mark all invoiced
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ── Projects — each its own report ──────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-title-medium">Projects</h2>
            {report.data.projects.length === 0 ? (
              <p className="text-body-small text-m-on-surface-variant">
                No un-invoiced project work completed in this cycle.
              </p>
            ) : (
              report.data.projects.map((p) => (
                <Card key={p.project_id}>
                  <CardContent className="p-0">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-m-outline-variant px-4 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {p.tasks.length > 0 && (
                          <Checkbox
                            className="mt-1 shrink-0"
                            checked={projectAllSelected(p)}
                            onCheckedChange={(v) => setAllProject(p, v === true)}
                            aria-label={`Select all tasks in ${p.name}`}
                          />
                        )}
                        <div className="min-w-0">
                          <h3 className="break-words text-title-small text-m-on-surface">
                            {p.name}
                          </h3>
                          <p className="text-label-small text-m-on-surface-variant">
                            {p.tasks.length} completed task{p.tasks.length !== 1 ? "s" : ""} ·{" "}
                            {p.hours_total.toFixed(2)}h
                            {p.open_task_count > 0 && ` · ${p.open_task_count} still open`}
                            {p.completed_at && ` · project completed ${formatDate(p.completed_at)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {p.quote_total_cents !== null && (
                          <div className="text-right">
                            <Money
                              cents={p.quote_total_cents}
                              className="text-title-small font-semibold"
                            />
                            <p className="text-label-small text-m-on-surface-variant">quoted</p>
                          </div>
                        )}
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            markProject.mutate({ id: p.project_id, label: p.name })
                          }
                        >
                          Mark project invoiced
                        </Button>
                      </div>
                    </div>
                    <ul className="divide-y divide-m-outline-variant">
                      {p.tasks.map((t, idx) => (
                        <li key={idx} className="flex items-start gap-3 px-4 py-2">
                          <Checkbox
                            className="mt-0.5 shrink-0"
                            checked={selectedTasks.has(taskKey(p.project_id, idx))}
                            onCheckedChange={() => toggleTask(taskKey(p.project_id, idx))}
                            aria-label={`Select ${t.name}`}
                          />
                          <span className="min-w-0 flex-1 break-words text-body-small text-m-on-surface">
                            {t.name}
                            {t.carried_over && (
                              <Badge variant="warning" className="ml-2 whitespace-nowrap">
                                Carried over
                              </Badge>
                            )}
                          </span>
                          <span className="shrink-0 text-label-small text-m-on-surface-variant">
                            {formatDate(t.closed_at)}
                          </span>
                          <span className="w-16 shrink-0 text-right text-body-small tabular-nums">
                            {t.hours.toFixed(2)}h
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))
            )}
          </section>

          {report.data.warnings.length > 0 && (
            <ul className="space-y-1 text-body-small text-m-error">
              {report.data.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
