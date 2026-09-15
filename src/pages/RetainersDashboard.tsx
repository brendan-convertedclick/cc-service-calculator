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
import { useTeamDaysOff, useSetDayOff, type DayOff, type DayOffKind } from "@/hooks/useTeamDaysOff";
import { todayISO } from "@/lib/dates";
import { cn, errorMessage } from "@/lib/utils";
import { toast } from "sonner";

/** Every Monday to Friday of the month as "YYYY-MM-DD", local. */
function workingDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

// Click cycles a day: nothing → leave → half leave → sick → half sick →
// public holiday → nothing (0173). Holidays are seeded for the year, and a
// person who worked one clicks through to clear it.
type Mark = { kind: DayOffKind; fraction: number } | null;
const CYCLE: Mark[] = [
  null,
  { kind: "leave", fraction: 1 },
  { kind: "leave", fraction: 0.5 },
  { kind: "sick", fraction: 1 },
  { kind: "sick", fraction: 0.5 },
  { kind: "holiday", fraction: 1 },
];
function nextMark(cur: Mark): Mark {
  const i = CYCLE.findIndex((m) => m?.kind === cur?.kind && m?.fraction === cur?.fraction);
  return CYCLE[(i + 1) % CYCLE.length];
}
const KIND_STYLE: Record<DayOffKind, string> = {
  leave: "bg-m-primary-container text-m-on-primary-container",
  sick: "bg-m-error-container text-m-on-error-container",
  holiday: "bg-m-tertiary-container text-m-on-tertiary-container",
};
const KIND_LABEL: Record<DayOffKind, string> = { leave: "L", sick: "S", holiday: "PH" };
const markLabel = (m: Mark) => (m ? `${KIND_LABEL[m.kind]}${m.fraction === 0.5 ? "½" : ""}` : "");

// The month as a grid: who was off which day (Lisa, 2026-09-15). Each mark
// takes 7h off that person's capacity above, so the ring and Of capacity
// column move with it. Weekends are not offered; they were never capacity.
function DaysOffGrid({
  month,
  people,
  daysOff,
}: {
  month: string;
  people: Array<{ id: string; name: string }>;
  daysOff: DayOff[];
}) {
  const dates = workingDates(month);
  const today = todayISO();
  const set = useSetDayOff(month);
  const byKey = new Map(daysOff.map((d) => [`${d.team_member_id}|${d.day}`, d]));
  // A holiday everyone has is a column, not four cells: the header names it.
  const holidayName = new Map<string, string>();
  for (const d of daysOff) if (d.kind === "holiday" && d.note) holidayName.set(d.day, d.note);
  return (
    <Card className="mt-6">
      <CardContent className="p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-label-large text-m-on-surface">Days off</div>
            <p className="text-label-small text-m-on-surface-variant">
              Click a day to cycle it: leave, half leave, sick, half sick, public holiday, clear. A whole day off takes {HOURS_PER_WORKING_DAY}h off that person's capacity, a half day {HOURS_PER_WORKING_DAY / 2}h. South African public holidays are preloaded for 2026 and 2027.
            </p>
          </div>
          <div className="flex gap-3 text-label-small text-m-on-surface-variant">
            <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-4 w-4 rounded-sm text-center text-[10px] leading-4", KIND_STYLE.leave)}>L</span>Leave</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-4 w-4 rounded-sm text-center text-[10px] leading-4", KIND_STYLE.sick)}>S</span>Sick</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-4 min-w-4 rounded-sm px-0.5 text-center text-[10px] leading-4", KIND_STYLE.holiday)}>PH</span>Public holiday</span>
            <span>½ = half day</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1 text-label-small">
            <thead>
              <tr>
                <th className="w-40 text-left font-normal text-m-on-surface-variant">Who</th>
                {dates.map((d) => {
                  const dt = new Date(`${d}T00:00:00`);
                  return (
                    <th
                      key={d}
                      className={cn(
                        "min-w-7 px-0.5 text-center font-normal text-m-on-surface-variant",
                        d === today && "text-m-primary font-semibold",
                      )}
                      title={holidayName.get(d) ? `${d}: ${holidayName.get(d)}` : d}
                    >
                      <div>{"SMTWTFS"[dt.getDay()]}</div>
                      <div className="font-mono tabular-nums">{dt.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="text-body-medium text-m-on-surface">{p.name}</td>
                  {dates.map((d) => {
                    const row = byKey.get(`${p.id}|${d}`);
                    const mark: Mark = row ? { kind: row.kind, fraction: Number(row.fraction) } : null;
                    return (
                      <td key={d} className="px-0.5 text-center">
                        <button
                          type="button"
                          aria-label={`${p.name}, ${d}: ${mark ? `${mark.kind}${mark.fraction === 0.5 ? " half day" : ""}` : "working"}`}
                          title={row?.note ?? undefined}
                          disabled={set.isPending}
                          onClick={() => {
                            const next = nextMark(mark);
                            set.mutate(
                              { team_member_id: p.id, day: d, kind: next?.kind ?? null, fraction: next?.fraction },
                              { onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`) },
                            );
                          }}
                          className={cn(
                            "h-7 w-7 rounded-sm font-mono text-[11px] transition-colors",
                            mark ? KIND_STYLE[mark.kind] : "bg-m-surface-container-high hover:bg-m-surface-container-highest",
                            d === today && !mark && "ring-1 ring-m-primary/40",
                          )}
                        >
                          {markLabel(mark)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

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

// The month as one ring (Lisa, 2026-09-15: "a visual reference which clearly
// shows where we are in the month"). The full circle is every working hour
// the team has this month; the faint arc is how much of it has passed; the
// solid arc is what Conductor can account for. On track means the solid arc
// keeps pace with the faint one. Points-based, like everything on this page.
function CapacityRing({
  accounted,
  elapsed,
  available,
  label,
  size = 128,
}: {
  accounted: number;
  elapsed: number;
  available: number;
  label: string;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = (n: number) => (available > 0 ? Math.min(1, Math.max(0, n / available)) : 0);
  const ring = (n: number, colour: string) => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke={colour}
      strokeWidth={stroke}
      strokeDasharray={`${c * frac(n)} ${c}`}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${fmtH(accounted)} accounted of ${fmtH(elapsed)} elapsed, ${fmtH(available)} in the month`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--mcolor-surface-container-high))" strokeWidth={stroke} />
      {ring(elapsed, "hsl(var(--mcolor-outline))")}
      {ring(accounted, "hsl(var(--mcolor-primary))")}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-m-on-surface font-mono"
        style={{ fontSize: size * 0.22, fontWeight: 600 }}
      >
        {label}
      </text>
    </svg>
  );
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
    ["Ongoing", "Time logged this month on standing tasks that never close: Ops Development, Finance, admin, the [Ongoing] overhead tasks. No points on those, so this is the one bucket counted in tracked hours. Internal and never billable, but it is real capacity used."],
    ["Accounted", "That person's Briefed, Recurring, Meetings and Ongoing added together. It is what their month contained, not how long they sat at their desk."],
    ["Tracked", "Time actually tracked in ClickUp (via Rize) on the same tasks: briefs, recurring, meetings and ongoing, and what share of Accounted that covers. Points are the basis and stay the basis; this column is the comparison."],
    ["Of capacity","Their accounted hours against what one person's month holds: working days × 7 hours. Under 100% is normal; very low means work is going unrecorded, not that nobody was busy."],
    ["Load", "The same percentage as a bar. Red under 40%, amber to 80%, green above — low is what this page is looking for, so low is what shouts."],
    ["Days off", "Leave, sick days and public holidays in the grid at the bottom. Each whole day takes 7 hours off that person's capacity and off the team total, a half day 3.5, so a month with leave or a holiday in it is judged against the hours people actually had."],
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
  const { data: daysOff = [] } = useTeamDaysOff(month);

  // Days off per person, split into the part of the month that has passed
  // and the whole month (0172). A day off is not capacity.
  const off = useMemo(() => {
    const today = todayISO();
    const perPerson = new Map<string, { elapsed: number; total: number }>();
    let elapsed = 0;
    let total = 0;
    for (const d of daysOff) {
      const cur = perPerson.get(d.team_member_id) ?? { elapsed: 0, total: 0 };
      const f = Number(d.fraction ?? 1);
      cur.total += f;
      total += f;
      if (d.day <= today) {
        cur.elapsed += f;
        elapsed += f;
      }
      perPerson.set(d.team_member_id, cur);
    }
    return { perPerson, elapsed, total };
  }, [daysOff]);

  const cap = useMemo(
    () =>
      teamCapacity({
        month,
        headcount: data?.headcount ?? 0,
        accountedHours: data?.accountedHours ?? 0,
        daysOff: { elapsed: off.elapsed, total: off.total },
      }),
    [month, data?.headcount, data?.accountedHours, off],
  );
  const perPersonHours = (id: string | null) =>
    personCapacityHours(month, new Date(), id ? off.perPerson.get(id)?.elapsed ?? 0 : 0);

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
            <div className="flex items-center gap-5">
              <CapacityRing
                accounted={cap.accountedHours}
                elapsed={cap.elapsedHours}
                available={cap.availableHours}
                label={fmtPct(cap.inProgress ? cap.pctOfElapsed : cap.pctOfMonth)}
              />
              <div className="space-y-1.5 text-label-small text-m-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-primary" />
                  Accounted {fmtH(cap.accountedHours)}
                </div>
                {cap.inProgress && (
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-outline" />
                    Month so far {fmtH(cap.elapsedHours)}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-surface-container-high" />
                  Whole month {fmtH(cap.availableHours)}
                </div>
                <div className="pt-1.5 text-m-on-surface-variant/80">
                  Briefed {fmtH(data?.briefedHours ?? 0)} · Recurring {fmtH(data?.recurringHours ?? 0)} · Meetings{" "}
                  {fmtH(data?.meetingHours ?? 0)} · Ongoing {fmtH(data?.ongoingHours ?? 0)} · Tracked{" "}
                  {fmtH(data?.trackedHours ?? 0)}
                </div>
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
                <TableHead className="whitespace-nowrap text-right" title="Time tracked in ClickUp on the same closed tasks">Tracked</TableHead>
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
                const perPerson = perPersonHours(p.id);
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
                      {fmtH(p.trackedHours)}
                      {p.totalHours > 0 && (
                        <span className="ml-1 text-label-small">
                          ({Math.round((p.trackedHours / p.totalHours) * 100)}%)
                        </span>
                      )}
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

      <DaysOffGrid
        month={month}
        people={people.filter((p): p is PersonLoad & { id: string } => !!p.id)}
        daysOff={daysOff}
      />

      <p className="mt-4 max-w-3xl text-label-small text-m-on-surface-variant">
        A low figure is not the same as a quiet month — it usually means work
        that happened was never briefed through Conductor, or went out with
        nobody assigned to it. That is what this page is for finding.
      </p>
    </div>
  );
}
