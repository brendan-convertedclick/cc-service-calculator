import { Fragment, useMemo, useState } from "react";
import { ProgressRing } from "@/components/retainers/ProgressRing";
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
import { useTeamDaysOff, useTeamDaysOffBetween, useSetDayOff, type DayOff, type DayOffKind } from "@/hooks/useTeamDaysOff";
import { anchorFor, periodFor, type PeriodKind } from "@/lib/capacity-period";
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
  const set = useSetDayOff();
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
    ["Meetings", "Hours from that person's meeting tasks closed this month, at the points on the task."],
    ["Total hours", "That person's Briefed, Recurring, Meetings and Ongoing added together, in points. It is what their month contained, not how long they sat at their desk. Tracked is not added on top: it is the same work measured the other way, so adding it would count it twice."],
    ["Tracked", "Every hour logged in ClickUp (via Rize) inside this period, whatever state its task is in. It is not limited to work that closed here, so a week spent on something still in flight shows up. Expand the row and those tasks are listed too, marked tracked. Points are the basis and stay the basis; this column is the comparison."],
    ["Total points", "The sprint points on everything that person closed this month: briefs, recurring and meetings. This is the number ClickUp's points dashboard shows, so the two should match. Ongoing tasks carry no points and are not in it."],
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
  // Month > Week > Day (Lisa, 2026-09-21). The anchor is whatever the picker
  // for that granularity holds; switching granularity keeps you on the same
  // point in time rather than jumping to today.
  const [kind, setKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(() => currentMonthKey());
  const period = useMemo(() => periodFor(kind, anchor), [kind, anchor]);
  const month = period.startDate.slice(0, 7);
  const { data, isLoading } = useTeamCapacity(period);
  // Two reads, two jobs. The maths deducts only the days off inside the
  // period; the grid at the bottom is a MONTH grid and always shows the whole
  // month, so a week view does not blank out the rest of it.
  const { data: daysOff = [] } = useTeamDaysOffBetween(period.startDate, period.endDate);
  const { data: monthDaysOff = [] } = useTeamDaysOff(month);

  function changeKind(next: PeriodKind) {
    // Narrowing from the current month should land on THIS week, not on the
    // week the 1st fell in — that one is usually half in the previous month
    // and is never the week you meant. Narrowing from a past period has no
    // "today" in it, so it keeps that period's first day.
    const today = todayISO();
    const inside = today >= period.startDate && today < period.endDate;
    setAnchor(anchorFor(next, inside ? today : period.startDate));
    setKind(next);
  }

  // Days off per person, split into the part of the period that has passed
  // and the whole of it (0172). A day off is not capacity, at any
  // granularity — a week somebody is on leave in is exactly the week this
  // page gets opened for.
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
        period,
        headcount: data?.headcount ?? 0,
        accountedHours: data?.accountedHours ?? 0,
        daysOff: { elapsed: off.elapsed, total: off.total },
      }),
    [period, data?.headcount, data?.accountedHours, off],
  );
  const perPersonHours = (id: string | null) =>
    personCapacityHours(period, new Date(), id ? off.perPerson.get(id)?.elapsed ?? 0 : 0);

  // "Week so far", not CSS `capitalize`, which would title-case every word of
  // it into "Week So Far".
  const kindLabel = kind[0].toUpperCase() + kind.slice(1);

  const people: PersonLoad[] = data?.people ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Retainers</h1>
          <p className="text-body-medium text-m-on-surface-variant">
            How much of the {kind} the team has accounted for.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* One control, three granularities. Native pickers rather than a
              calendar library: the browser already knows what a week is, and
              <input type="week"> is Monday-start, which is the week this page
              means. */}
          <div className="flex h-10 items-center rounded-md border border-m-outline-variant p-0.5">
            {(["month", "week", "day"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(k)}
                aria-pressed={kind === k}
                className={`h-full rounded px-3 text-label-small capitalize transition-colors ${
                  kind === k
                    ? "bg-m-secondary-container text-m-on-secondary-container"
                    : "text-m-on-surface-variant hover:text-m-on-surface"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            type={kind === "month" ? "month" : kind === "week" ? "week" : "date"}
            aria-label={`Select ${kind}`}
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
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
                  ? `. Measured against the part of ${period.label} that has happened; the whole ${kind} is ${fmtH(cap.availableHours)}.`
                  : `, across ${period.label}.`}{" "}
                Counted in the points on every task closed in the {kind} — briefed,
                recurring, client and internal alike — not in logged time.
                {kind === "day" && " A task lands on the day it closed, so single days swing hard: the week view is the smoother read."}
              </p>
            </div>
            <div className="flex items-center gap-5">
              <ProgressRing
                done={cap.accountedHours}
                expected={cap.elapsedHours}
                total={cap.availableHours}
                label={fmtPct(cap.inProgress ? cap.pctOfElapsed : cap.pctOfMonth)}
              />
              <div className="space-y-1.5 text-label-small text-m-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-primary" />
                  Accounted {fmtH(cap.accountedHours)}
                </div>
                {/* A day that is still running has one elapsed working day —
                    the whole of it — because work lands when a task closes,
                    not by the clock. So the "so far" line would repeat the
                    one under it. */}
                {cap.inProgress && cap.elapsedHours !== cap.availableHours && (
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-outline" />
                    {kindLabel} so far {fmtH(cap.elapsedHours)}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-m-surface-container-high" />
                  Whole {kind} {fmtH(cap.availableHours)}
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
                <TableHead className="whitespace-nowrap text-right">Meetings</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Hours logged this month on standing tasks that never close">Ongoing</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Briefed, Recurring, Meetings and Ongoing added together">Total hours</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Time logged in ClickUp inside this period, whatever state its task is in">Tracked</TableHead>
                <TableHead className="whitespace-nowrap text-right" title="Sprint points on everything closed this month, as ClickUp's dashboard counts them">Total points</TableHead>
                <TableHead className="whitespace-nowrap text-right">Of capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-body-medium text-m-on-surface-variant">
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
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {fmtH(p.meetingHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {fmtH(p.ongoingHours)}
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
                      {Math.round(p.totalPoints * 10) / 10}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                      {pct != null ? `${fmtPct(pct)} of ${fmtH(perPerson)}` : "—"}
                    </TableCell>
                  </TableRow>
                  {open[key] && p.items.length > 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={10} className="bg-m-surface-container-low p-0">
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

      {/* A month grid, so it belongs to the month view. Its marks still count
          against a week or a day — the deduction reads the period, this is
          only where you edit them — but showing August's grid under a week
          that starts on 31 August reads as the page having changed month. */}
      {kind === "month" && (
        <DaysOffGrid
          month={month}
          people={people.filter((p): p is PersonLoad & { id: string } => !!p.id)}
          daysOff={monthDaysOff}
        />
      )}

      <p className="mt-4 max-w-3xl text-label-small text-m-on-surface-variant">
        A low figure is not the same as a quiet month — it usually means work
        that happened was never briefed through Conductor, or went out with
        nobody assigned to it. That is what this page is for finding.
      </p>
    </div>
  );
}
