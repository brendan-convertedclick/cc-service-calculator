// src/components/moments/MomentsCalendar.tsx
//
// Week, month and year views of /moments. Clicking a day is how you add to
// it — the whole square is the target, because "add Thandi's daughter's
// matric dance on the 17th" should be one click on the 17th — and clicking a
// chip opens that date instead.
//
// Colour is the kind (birthday / event / anniversary), never urgency: these
// are reasons to talk to someone, not deadlines. A date somebody has already
// asked about fades and carries a tick, so a colleague does not ask twice.

import { Plus } from "lucide-react";
import { monthGrid, WEEKDAY_LABELS, type CalendarEntry } from "@/lib/calendar-month";
import {
  addDays,
  askKey,
  occurrenceTitle,
  type MomentAsk,
  type Occurrence,
} from "@/lib/contact-moments";
import { todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { KIND_CHIP, KIND_DOT } from "./kind-styles";

export type MomentsView = "week" | "month" | "year";

const occId = (o: Occurrence) => `${o.moment.id}|${o.date}`;

function chipText(o: Occurrence): string {
  if (o.moment.kind === "birthday") return `🎂 ${o.moment.contactName}`;
  const first = o.moment.contactName.split(" ")[0];
  return `${first}: ${occurrenceTitle(o)}`;
}

type Props = {
  view: MomentsView;
  /** Any date inside the week, month or year being shown. */
  anchor: string;
  occurrences: Occurrence[];
  asked: Map<string, MomentAsk>;
  canAdd: boolean;
  onDayClick: (date: string) => void;
  onPick: (o: Occurrence) => void;
  onOpenMonth: (date: string) => void;
};

export function MomentsCalendar(props: Props) {
  if (props.view === "week") return <WeekView {...props} />;
  if (props.view === "year") return <YearView {...props} />;
  return <MonthView {...props} />;
}

function Chip({
  o,
  asked,
  onPick,
  className,
}: {
  o: Occurrence;
  asked: boolean;
  onPick: (o: Occurrence) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={occurrenceTitle(o) + (asked ? " — asked" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onPick(o);
      }}
      className={cn(
        "w-full truncate rounded px-1.5 py-0.5 text-left text-label-small hover:opacity-80",
        KIND_CHIP[o.moment.kind],
        asked && "opacity-60",
        className,
      )}
    >
      {asked ? <span aria-hidden>✓ </span> : null}
      {chipText(o)}
    </button>
  );
}

function AddHint({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-auto flex items-center gap-0.5 text-label-small text-m-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
      <Plus className="h-3 w-3" aria-hidden /> Add
    </span>
  );
}

function MonthView({ anchor, occurrences, asked, canAdd, onDayClick, onPick }: Props) {
  const byId = new Map(occurrences.map((o) => [occId(o), o]));
  const entries: CalendarEntry[] = occurrences.map((o) => ({
    id: occId(o),
    date: o.date,
    label: occurrenceTitle(o),
    kind: "event",
  }));
  const weeks = monthGrid(anchor.slice(0, 7), entries);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[40rem]">
        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="px-2 pb-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-m-outline-variant p-px">
          {weeks.flat().map((day) => (
            <div
              key={day.date}
              data-testid={`day-${day.date}`}
              role={canAdd ? "button" : undefined}
              tabIndex={canAdd ? 0 : undefined}
              aria-label={canAdd ? `Add a date on ${day.date}` : undefined}
              onClick={canAdd ? () => onDayClick(day.date) : undefined}
              onKeyDown={
                canAdd
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDayClick(day.date);
                      }
                    }
                  : undefined
              }
              className={cn(
                "group flex min-h-[6.5rem] flex-col gap-1 bg-m-surface p-1.5 outline-none",
                !day.inMonth && "bg-m-surface-container",
                canAdd && "cursor-pointer hover:bg-m-surface-container-low focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m-primary",
              )}
            >
              <div className="flex items-center">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-label-small tabular-nums",
                    day.isToday
                      ? "bg-m-primary text-m-on-primary"
                      : day.inMonth
                        ? "text-m-on-surface"
                        : "text-m-on-surface-variant/70",
                  )}
                >
                  {day.dayOfMonth}
                </span>
                <AddHint show={canAdd} />
              </div>
              <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
                {day.entries.map((e) => {
                  const o = byId.get(e.id);
                  if (!o) return null;
                  return (
                    <Chip key={e.id} o={o} asked={asked.has(askKey(o.moment.id, o.date, "before"))} onPick={onPick} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekView({ anchor, occurrences, asked, canAdd, onDayClick, onPick }: Props) {
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((date, i) => {
        const items = occurrences.filter((o) => o.date === date);
        return (
          <div
            key={date}
            role={canAdd ? "button" : undefined}
            tabIndex={canAdd ? 0 : undefined}
            aria-label={canAdd ? `Add a date on ${date}` : undefined}
            onClick={canAdd ? () => onDayClick(date) : undefined}
            onKeyDown={
              canAdd
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDayClick(date);
                    }
                  }
                : undefined
            }
            className={cn(
              "group flex min-w-0 flex-col gap-1.5 rounded-lg border border-m-outline-variant bg-m-surface p-2 outline-none md:min-h-[14rem]",
              date === today && "border-m-primary",
              canAdd && "cursor-pointer hover:bg-m-surface-container-low focus-visible:ring-2 focus-visible:ring-m-primary",
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-title-large tabular-nums text-m-on-surface">{Number(date.slice(8))}</span>
              <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">
                {WEEKDAY_LABELS[i]}
              </span>
              <AddHint show={canAdd} />
            </div>
            {items.map((o) => {
              const done = asked.has(askKey(o.moment.id, o.date, "before"));
              return (
                <button
                  key={occId(o)}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(o);
                  }}
                  className={cn(
                    "grid gap-0.5 rounded-md px-2 py-1.5 text-left text-body-small hover:opacity-80",
                    KIND_CHIP[o.moment.kind],
                    done && "opacity-60",
                  )}
                >
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {occurrenceTitle(o)}
                    {done ? " ✓" : ""}
                  </span>
                  <span className="opacity-80 [overflow-wrap:anywhere]">
                    {o.moment.kind === "birthday" ? o.moment.clientName : `${o.moment.contactName} · ${o.moment.clientName}`}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString("en-ZA", { month: "long" }),
);

function YearView({ anchor, occurrences, asked, onPick, onOpenMonth }: Props) {
  const year = anchor.slice(0, 4);
  const thisMonth = todayISO().slice(0, 7);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
      {MONTH_NAMES.map((name, i) => {
        const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
        const items = occurrences.filter((o) => o.date.startsWith(prefix));
        return (
          <div
            key={prefix}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-lg border border-m-outline-variant bg-m-surface p-3",
              prefix === thisMonth && "border-m-primary",
            )}
          >
            <div className="flex items-baseline justify-between">
              <button
                type="button"
                onClick={() => onOpenMonth(`${prefix}-01`)}
                className="text-title-small text-m-on-surface hover:text-m-primary"
              >
                {name}
              </button>
              <span className="text-label-small tabular-nums text-m-on-surface-variant">{items.length || ""}</span>
            </div>
            {items.length === 0 ? (
              <span className="text-body-small text-m-on-surface-variant">Nothing noted</span>
            ) : (
              items.map((o) => (
                <button
                  key={occId(o)}
                  type="button"
                  onClick={() => onPick(o)}
                  className={cn(
                    "grid grid-cols-[1.5rem_0.5rem_minmax(0,1fr)] items-center gap-1.5 text-left text-body-small hover:underline",
                    asked.has(askKey(o.moment.id, o.date, "before")) && "opacity-60",
                  )}
                >
                  <span className="text-right tabular-nums text-m-on-surface-variant">{Number(o.date.slice(8))}</span>
                  <span className={cn("h-2 w-2 rounded-full", KIND_DOT[o.moment.kind])} />
                  <span className="truncate">
                    {occurrenceTitle(o)}
                    {o.moment.kind !== "birthday" ? ` · ${o.moment.contactName}` : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
