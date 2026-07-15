// src/pages/Reports.tsx
//
// Per-client invoice run on a 20th → 20th billing cycle. Pulls completed,
// un-invoiced work from get-invoice-report:
//   - Ad hoc quick-task briefs (completion live from ClickUp) as one list.
//   - Each fixed project as its own report card.
// Marking a line/project invoiced stamps invoiced_at so it drops out of
// future runs; an inline Undo covers accidental clicks.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const DAY_MONTH = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDate(iso: string): string {
  return DAY_MONTH_YEAR.format(new Date(iso));
}

export function Reports() {
  const { currentUserId } = useAuth();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<string>("");
  // Months back from the default cycle (0 = most recent complete cycle).
  const [cycleOffset, setCycleOffset] = useState(0);
  const [justMarked, setJustMarked] = useState<
    { kind: "briefs" | "project"; ids: string[]; label: string }[]
  >([]);

  const cycle = useMemo(() => {
    const base = defaultCycleEnd(new Date());
    const end = new Date(base.getFullYear(), base.getMonth() - cycleOffset, 20);
    const start = new Date(end.getFullYear(), end.getMonth() - 1, 20);
    return { start, end };
  }, [cycleOffset]);

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
    enabled: !!clientId,
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

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-headline-small">Reports</h1>
        <p className="text-body-small text-m-on-surface-variant">
          Completed, un-invoiced work per client, on a 20th-to-20th billing cycle.
          Mark lines invoiced to drop them from future runs.
        </p>
      </header>

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
          <label className="text-label-small text-m-on-surface-variant">Billing cycle</label>
          <div className="flex items-center gap-1 rounded-md border border-input px-1 py-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Previous cycle"
              onClick={() => setCycleOffset((o) => o + 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[11rem] text-center text-body-small tabular-nums">
              {DAY_MONTH.format(cycle.start)} – {DAY_MONTH_YEAR.format(cycle.end)}
              {cycleOffset < 0 && (
                <span className="ml-1 text-label-small text-m-on-surface-variant">
                  (in progress)
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Next cycle"
              disabled={cycleOffset <= -1}
              onClick={() => setCycleOffset((o) => Math.max(-1, o - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {justMarked.map((m) => (
        <div
          key={m.kind + m.ids.join()}
          className="flex items-center justify-between gap-3 rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-2"
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

      {!clientId && (
        <p className="text-body-medium text-m-on-surface-variant">
          Pick a client to build their invoice report.
        </p>
      )}
      {report.isLoading && (
        <p className="text-body-small text-m-on-surface-variant">Building report…</p>
      )}
      {report.error && (
        <p className="text-body-small text-m-error">{(report.error as Error).message}</p>
      )}

      {report.data && (
        <>
          {/* ── Ad hoc work ─────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-title-medium">Ad hoc work</h2>
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
