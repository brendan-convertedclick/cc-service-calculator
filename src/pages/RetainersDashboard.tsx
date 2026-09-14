import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentMonthKey } from "@/hooks/usePulseRetainerBurn";
import {
  useTeamCapacity,
  UNASSIGNED,
  type PersonLoad,
  type CapacityItem,
} from "@/hooks/useTeamCapacity";
import { teamCapacity, personCapacityHours, HOURS_PER_WORKING_DAY } from "@/lib/capacity";
import { cn } from "@/lib/utils";

function fmtH(n: number): string {
  return `${Math.round(n * 10) / 10}h`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

// One bar, one meaning: how full is this person's month. Deliberately not
// red-at-the-top — over capacity is worth seeing but it is not an error, and a
// page of red says nothing. Low is what this page exists to find.
function loadTone(pct: number): string {
  if (pct >= 80) return "bg-m-tertiary";
  if (pct >= 40) return "bg-amber-500";
  return "bg-m-error";
}

function LoadBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
      <div
        className={cn("h-full rounded-full", loadTone(pct))}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// Lisa, 2026-09-10: "What does Accounted mean" and "add a key explaining each
// column name and what the numbers are showing us" — asked within a minute of
// each other, which is the page telling you its labels are not self-evident.
// Same native <details> as the Retainers book, open by default.
function CapacityKey() {
  const terms: Array<[string, string]> = [
    ["Accounted for", "The share of the team's working hours that Conductor can see work against. Everything closed in the month — briefed, recurring, client and internal — valued at the points on the task. It is not a productivity score: a low figure usually means work that happened was never briefed here."],
    ["Briefed", "Hours from tasks somebody raised as a brief and closed this month."],
    ["Recurring", "Hours from the standing monthly tasks the provisioner creates — reports, plugin sweeps, standing meetings — that closed this month."],
    ["Accounted", "That person's Briefed and Recurring added together. It is what their month contained, not how long they sat at their desk."],
    ["Of capacity", "Their accounted hours against what one person's month holds: working days × 7 hours. Under 100% is normal; very low means work is going unrecorded, not that nobody was busy."],
    ["Load", "The same percentage as a bar. Red under 40%, amber to 80%, green above — low is what this page is looking for, so low is what shouts."],
    ["Unassigned", "Work closed this month with nobody's name on it. It has no capacity to be a share of, so it shows no percentage — but the hours are real and are in the total."],
  ];
  return (
    <details className="mb-6 rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-2" open>
      <summary className="cursor-pointer text-label-large text-m-on-surface-variant">
        What these numbers mean
      </summary>
      <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {terms.map(([term, meaning]) => (
          <div key={term}>
            <dt className="text-label-large text-m-on-surface">{term}</dt>
            <dd className="text-label-small text-m-on-surface-variant">{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// What one person's month was actually made of. The Unassigned row is the
// reason this exists: "30.3h across 25 tasks" is a finding nobody can act on
// until they can see which tasks.
function CapacityItems({ items }: { items: CapacityItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-12">Task</TableHead>
          <TableHead>Client</TableHead>
          <TableHead className="whitespace-nowrap text-right">Hours</TableHead>
          <TableHead className="whitespace-nowrap">Closed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <TableRow key={`${it.kind}-${it.id}`} className="[&>td]:py-2">
            <TableCell className="pl-12 text-body-medium text-m-on-surface">
              {it.name}
              {it.kind !== "brief" && (
                <span className="ml-2 text-label-small text-m-on-surface-variant">{it.kind}</span>
              )}
            </TableCell>
            <TableCell className="text-body-medium text-m-on-surface-variant">{it.clientName}</TableCell>
            <TableCell className="whitespace-nowrap text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
              {fmtH(it.hours)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-label-small text-m-on-surface-variant">
              {it.closedAt ? it.closedAt.slice(0, 10) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RetainersDashboard() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => currentMonthKey());
  const { data, isLoading } = useTeamCapacity(month);

  const cap = useMemo(
    () =>
      teamCapacity({
        month,
        headcount: data?.headcount ?? 0,
        accountedHours: data?.accountedHours ?? 0,
      }),
    [month, data?.headcount, data?.accountedHours],
  );
  const perPerson = useMemo(() => personCapacityHours(month), [month]);

  const people: PersonLoad[] = data?.people ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Retainers</h1>
          <p className="text-body-medium text-m-on-surface-variant">
            How much of the month the team has accounted for.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            aria-label="Select month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-10 rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small text-m-on-surface"
          />
          {/* Lisa: "recommend button for this it must be visible and easy to
              navigate to". The dashboard is the landing page; the book is one
              obvious click away rather than a nav item you have to know about. */}
          <Button onClick={() => navigate("/retainers/book")}>
            Open the retainer book
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <CapacityKey />

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-label-large text-m-on-surface-variant">
                Accounted for {cap.inProgress ? "so far" : ""}
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-display-small tabular-nums text-m-on-surface">
                  {fmtPct(cap.inProgress ? cap.pctOfElapsed : cap.pctOfMonth)}
                </span>
                <span className="text-body-medium text-m-on-surface-variant">
                  {fmtH(cap.accountedHours)} of{" "}
                  {fmtH(cap.inProgress ? cap.elapsedHours : cap.availableHours)}
                </span>
              </div>
              <p className="mt-2 max-w-xl text-label-small text-m-on-surface-variant">
                {data?.headcount ?? 0} people × {HOURS_PER_WORKING_DAY}h a day,
                Monday to Friday
                {cap.inProgress
                  ? ` — measured against the part of ${month} that has happened. The whole month is ${fmtH(cap.availableHours)}.`
                  : "."}{" "}
                Counted in the points on every task closed in the month — briefed,
                recurring, client and internal alike — not in logged time.
              </p>
            </div>
            <div className="min-w-56">
              <div className="flex justify-between text-label-small text-m-on-surface-variant">
                <span>Briefed {fmtH(data?.briefedHours ?? 0)}</span>
                <span>Recurring {fmtH(data?.recurringHours ?? 0)}</span>
                <span>Meetings {fmtH(data?.meetingHours ?? 0)}</span>
              </div>
              <div className="mt-2">
                <LoadBar pct={cap.inProgress ? cap.pctOfElapsed : cap.pctOfMonth} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead className="w-56">Load</TableHead>
                <TableHead className="whitespace-nowrap text-right">Briefed</TableHead>
                <TableHead className="whitespace-nowrap text-right">Recurring</TableHead>
                <TableHead className="whitespace-nowrap text-right">Accounted</TableHead>
                <TableHead className="whitespace-nowrap text-right">Of capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-body-medium text-m-on-surface-variant">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {people.map((p) => {
                // Unassigned work has no person and therefore no capacity to be
                // a share of — showing it a percentage would invent a colleague.
                const isPerson = p.name !== UNASSIGNED;
                const pct = isPerson && perPerson > 0 ? (p.totalHours / perPerson) * 100 : null;
                const key = p.id ?? UNASSIGNED;
                return (
                  <Fragment key={key}>
                  <TableRow className="[&>td]:py-3">
                    <TableCell className="text-body-medium text-m-on-surface">
                      <button
                        type="button"
                        aria-label={`${open[key] ? "Hide" : "Show"} tasks for ${p.name}`}
                        aria-expanded={!!open[key]}
                        disabled={p.items.length === 0}
                        onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                        className="inline-flex items-center gap-2 text-left disabled:opacity-50"
                      >
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 flex-none transition-transform",
                            open[key] && "rotate-90",
                          )}
                        />
                        {p.name}
                      </button>
                      {!isPerson && (
                        <span className="ml-2 text-label-small text-m-on-surface-variant">
                          {p.briefCount} task{p.briefCount === 1 ? "" : "s"} with nobody's name on
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{pct != null && <LoadBar pct={pct} />}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {fmtH(p.briefedHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {fmtH(p.recurringHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                      {fmtH(p.totalHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {pct != null ? `${fmtPct(pct)} of ${fmtH(perPerson)}` : "—"}
                    </TableCell>
                  </TableRow>
                  {open[key] && p.items.length > 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-m-surface-container-low p-0">
                        <CapacityItems items={p.items} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="mt-4 max-w-3xl text-label-small text-m-on-surface-variant">
        A low figure is not the same as a quiet month — it usually means work
        that happened was never briefed through Conductor, or went out with
        nobody assigned to it. That is what this page is for finding.
      </p>
    </div>
  );
}
