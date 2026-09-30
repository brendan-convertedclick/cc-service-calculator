// src/pages/Moments.tsx
//
// /moments — the personal dates an account owner keeps about the people they
// deal with at each school (0193): birthdays, a child's matric dance, ten
// years at the school. The calendar is for seeing them; "Ask about soon" is
// for acting on them, which is the whole reason to keep them.
//
// Click a day to add to it. Everything shown respects the same filters —
// whose schools, which school, which kinds — except that Ask-about-soon
// ignores the kind toggles: hiding birthdays from the grid to see the events
// should not also hide tomorrow's birthday from the list of things to say.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AskSoon } from "@/components/moments/AskSoon";
import { MomentDetailDialog } from "@/components/moments/MomentDetailDialog";
import { MomentFormDialog } from "@/components/moments/MomentFormDialog";
import { KIND_DOT } from "@/components/moments/kind-styles";
import { MomentsCalendar, type MomentsView } from "@/components/moments/MomentsCalendar";
import { useAuth } from "@/context/AuthContext";
import { useContactMoments, useMomentAsks, useMySchoolIds } from "@/hooks/useContactMoments";
import { monthLabel, shiftMonth } from "@/lib/calendar-month";
import {
  addDays,
  askIndex,
  KIND_META,
  MOMENT_KINDS,
  occurrencesBetween,
  soonList,
  weekStart,
  type Moment,
  type MomentKind,
  type Occurrence,
} from "@/lib/contact-moments";
import { todayISO } from "@/lib/dates";
import { cn, toggleInSet } from "@/lib/utils";

const VIEW_KEY = "moments.view";
const SCOPE_KEY = "moments.scope";

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a remembered view is a convenience */
  }
}

function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** The first and last day the view shows. A month pads a week either side for the grid's greyed days. */
function rangeFor(view: MomentsView, anchor: string): [string, string] {
  if (view === "week") return [anchor, addDays(anchor, 6)];
  if (view === "year") return [`${anchor.slice(0, 4)}-01-01`, `${anchor.slice(0, 4)}-12-31`];
  const first = `${anchor.slice(0, 7)}-01`;
  return [addDays(first, -7), addDays(`${shiftMonth(anchor.slice(0, 7), 1)}-01`, 7)];
}

function titleFor(view: MomentsView, anchor: string): string {
  if (view === "year") return anchor.slice(0, 4);
  if (view === "month") return monthLabel(anchor.slice(0, 7));
  const end = addDays(anchor, 6);
  return `${shortDate(anchor)} – ${shortDate(end)} ${end.slice(0, 4)}`;
}

/** Normalise the anchor to what the view steps by: a Monday, a 1st, or 1 January. */
function snap(view: MomentsView, date: string): string {
  if (view === "week") return weekStart(date);
  if (view === "year") return `${date.slice(0, 4)}-01-01`;
  return `${date.slice(0, 7)}-01`;
}

export function Moments() {
  const { currentUserId } = useAuth();
  const { data: moments = [], isLoading } = useContactMoments();
  const { data: asks = [] } = useMomentAsks();
  const { data: mySchools } = useMySchoolIds(currentUserId);

  const [view, setView] = useState<MomentsView>(() => stored(VIEW_KEY, ["week", "month", "year"] as const, "month"));
  const [anchor, setAnchor] = useState(() => snap(view, todayISO()));
  const [scope, setScope] = useState<"mine" | "all">(() => stored(SCOPE_KEY, ["mine", "all"] as const, "all"));
  const [school, setSchool] = useState("all");
  const [kinds, setKinds] = useState<Set<MomentKind>>(() => new Set(MOMENT_KINDS));

  const [adding, setAdding] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<Moment | null>(null);
  const [opened, setOpened] = useState<Occurrence | null>(null);

  const asked = useMemo(() => askIndex(asks), [asks]);
  // No team_members row (the shared team@ login) means nothing is "mine".
  const effectiveScope = currentUserId ? scope : "all";

  const inScope = useMemo(
    () =>
      moments.filter((m) => {
        if (school !== "all" && m.client_id !== school) return false;
        if (effectiveScope === "mine" && !(mySchools?.has(m.client_id) || m.created_by === currentUserId)) return false;
        return true;
      }),
    [moments, school, effectiveScope, mySchools, currentUserId],
  );

  const schoolOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of moments) byId.set(m.client_id, m.clientName);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [moments]);

  const [from, to] = rangeFor(view, anchor);
  const shown = occurrencesBetween(
    inScope.filter((m) => kinds.has(m.kind)),
    from,
    to,
  );
  const soon = soonList(inScope, asked, todayISO());
  const opening = opened ? moments.find((m) => m.id === opened.moment.id) : null;

  function changeView(v: MomentsView) {
    setView(v);
    remember(VIEW_KEY, v);
    // Keep today in view when it already was; otherwise keep the period being looked at.
    const today = todayISO();
    setAnchor(snap(v, snap(view, today) === anchor ? today : anchor));
  }
  function step(n: number) {
    if (view === "week") setAnchor(addDays(anchor, 7 * n));
    else if (view === "year") setAnchor(`${Number(anchor.slice(0, 4)) + n}-01-01`);
    else setAnchor(`${shiftMonth(anchor.slice(0, 7), n)}-01`);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-headline-medium">Moments</h1>
          <p className="mt-1 max-w-2xl text-body-medium text-m-on-surface-variant">
            Birthdays and big days for the people we work with at each school, so somebody remembers to ask.
            Click a day to add one.
          </p>
        </div>
        <Button onClick={() => setAdding({ date: todayISO() })} className="gap-1">
          <Plus className="h-4 w-4" /> Add a date
        </Button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-m-outline-variant bg-m-surface p-4" aria-label="Calendar">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto min-w-0 text-title-large text-m-on-surface">{titleFor(view, anchor)}</h2>
            <Button variant="outline" size="icon" aria-label="Previous" onClick={() => step(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(snap(view, todayISO()))}>
              Today
            </Button>
            <Button variant="outline" size="icon" aria-label="Next" onClick={() => step(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="flex rounded-full border border-m-outline-variant bg-m-surface-container p-0.5" role="group" aria-label="View">
              {(["week", "month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={cn(
                    "rounded-full px-3 py-1 text-label-large capitalize",
                    view === v ? "bg-m-surface text-m-on-surface shadow-elev-1" : "text-m-on-surface-variant",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentUserId ? (
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as "mine" | "all");
                  remember(SCOPE_KEY, v);
                }}
              >
                <SelectTrigger className="w-44" aria-label="Whose schools">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">My schools</SelectItem>
                  <SelectItem value="all">Everyone's schools</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            <Select value={school} onValueChange={setSchool}>
              <SelectTrigger className="w-56" aria-label="School">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All schools</SelectItem>
                {schoolOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {MOMENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kinds.has(k)}
                onClick={() => setKinds((prev) => toggleInSet(prev, k))}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-label-large",
                  kinds.has(k)
                    ? "border-m-outline text-m-on-surface"
                    : "border-m-outline-variant text-m-on-surface-variant opacity-70",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", KIND_DOT[k])} aria-hidden />
                {KIND_META[k].label}s
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
          ) : (
            <MomentsCalendar
              view={view}
              anchor={anchor}
              occurrences={shown}
              asked={asked}
              canAdd
              onDayClick={(date) => setAdding({ date })}
              onPick={setOpened}
              onOpenMonth={(date) => {
                setView("month");
                remember(VIEW_KEY, "month");
                setAnchor(date);
              }}
            />
          )}

          {!isLoading && moments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-m-outline-variant p-4 text-body-medium text-m-on-surface-variant">
              No dates yet. Click any day to add a birthday, or something coming up in someone's life: a school
              play, a big match, a new baby, a retirement.
            </p>
          ) : null}
          <p className="text-body-small text-m-on-surface-variant">A tick and faded colour means somebody has already asked.</p>
        </section>

        <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-m-outline-variant bg-m-surface p-4" aria-labelledby="ask-soon">
          <div>
            <h2 id="ask-soon" className="text-title-medium text-m-on-surface">
              Ask about soon
            </h2>
            <p className="text-body-small text-m-on-surface-variant">
              The next three weeks, plus events from the last ten days to follow up on.
            </p>
          </div>
          {isLoading ? null : <AskSoon list={soon} asked={asked} onOpen={setOpened} />}
        </aside>
      </div>

      <MomentFormDialog
        open={!!adding || !!editing}
        onOpenChange={(v) => {
          if (!v) {
            setAdding(null);
            setEditing(null);
          }
        }}
        date={adding?.date ?? editing?.on_date ?? todayISO()}
        moment={editing}
        presetClientId={school !== "all" ? school : undefined}
      />
      <MomentDetailDialog
        occurrence={opened && opening ? { ...opened, moment: opening } : null}
        asked={asked}
        onClose={() => setOpened(null)}
        onEdit={(o) => {
          setOpened(null);
          setEditing(o.moment);
        }}
      />
    </div>
  );
}
