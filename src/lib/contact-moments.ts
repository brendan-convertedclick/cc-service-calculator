// src/lib/contact-moments.ts
//
// Moments (0193): the personal dates an account owner keeps about the people
// at a school, expanded onto a calendar. Pure — no React, no network — so the
// week, month and year views and the "Ask about soon" list all agree about
// which day a birthday lands on.
//
// DATES ARE LOCAL "YYYY-MM-DD" STRINGS, the same rule as calendar-month.ts:
// `on_date` is a Postgres `date` and must never go through toISOString().
//
// A repeating moment is stored once and expanded here, every year from the
// year of `on_date` onwards. For a birthday that year is often a guess, which
// is fine: we only ever show the day, never an age.

import { toISODate } from "@/lib/dates";

export type MomentKind = "birthday" | "event" | "anniversary";

export const MOMENT_KINDS: MomentKind[] = ["birthday", "event", "anniversary"];

export const KIND_META: Record<MomentKind, { label: string; repeats: boolean; ask: string }> = {
  birthday: { label: "Birthday", repeats: true, ask: "Wish them a happy birthday" },
  event: { label: "Event", repeats: false, ask: "Wish them luck, then ask how it went" },
  anniversary: { label: "Anniversary", repeats: true, ask: "Congratulate them" },
};

export type Moment = {
  id: string;
  contact_id: string;
  client_id: string;
  kind: MomentKind;
  title: string | null;
  on_date: string;
  repeats_yearly: boolean;
  ask_about: string | null;
  notes: string | null;
  created_by: string | null;
  contactName: string;
  contactRole: string | null;
  clientName: string;
};

export type AskStage = "before" | "after";

export type MomentAsk = {
  moment_id: string;
  occurs_on: string;
  stage: AskStage;
  asked_by: string | null;
  asked_at: string;
};

export type Occurrence = {
  moment: Moment;
  /** The day it falls on in the range asked for. */
  date: string;
  /** Whole years since `on_date` — 0 for the first time, and for events. */
  nth: number;
};

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Monday of the week `date` falls in — the working week is the unit here too. */
export function weekStart(date: string): string {
  return addDays(date, -((parse(date).getDay() + 6) % 7));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** The same month and day in another year. 29 February becomes the 28th when there is no 29th. */
function inYear(date: string, year: number): string {
  const month = Number(date.slice(5, 7));
  let day = Number(date.slice(8, 10));
  if (month === 2 && day === 29 && !isLeap(year)) day = 28;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every time any of `moments` falls between `from` and `to`, inclusive, in date order. */
export function occurrencesBetween(moments: Moment[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const m of moments) {
    const startYear = Number(m.on_date.slice(0, 4));
    if (m.repeats_yearly) {
      for (let y = Math.max(fromYear, startYear); y <= toYear; y += 1) {
        const date = inYear(m.on_date, y);
        if (date >= from && date <= to) out.push({ moment: m, date, nth: y - startYear });
      }
    } else if (m.on_date >= from && m.on_date <= to) {
      out.push({ moment: m, date: m.on_date, nth: 0 });
    }
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.moment.contactName.localeCompare(b.moment.contactName),
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** What the day is, as a person would say it: "Thandi's birthday", "10 years at the school · 3rd". */
export function occurrenceTitle(o: Occurrence): string {
  const m = o.moment;
  if (m.kind === "birthday") return `${m.contactName}'s birthday`;
  const title = m.title || KIND_META[m.kind].label;
  return m.repeats_yearly && o.nth > 0 ? `${title} · ${ordinal(o.nth)}` : title;
}

/** One line to prompt the conversation. */
export function askLine(o: Occurrence, stage: AskStage): string {
  if (stage === "after") return `Ask how ${o.moment.title || "it"} went`;
  return o.moment.ask_about || KIND_META[o.moment.kind].ask;
}

export function askKey(momentId: string, date: string, stage: AskStage): string {
  return `${momentId}|${date}|${stage}`;
}

export function askIndex(asks: MomentAsk[]): Map<string, MomentAsk> {
  return new Map(asks.map((a) => [askKey(a.moment_id, a.occurs_on, a.stage), a]));
}

export type SoonList = {
  today: Occurrence[];
  thisWeek: Occurrence[];
  later: Occurrence[];
  /** One-off events in the last `backDays` nobody has asked about afterwards. */
  followUps: Occurrence[];
};

/**
 * What to bring up next: the next three weeks, plus recent events still worth
 * a "how did it go?". Repeating dates get no follow-up — nobody asks how a
 * birthday went.
 */
export function soonList(
  moments: Moment[],
  asked: Map<string, MomentAsk>,
  today: string,
  aheadDays = 21,
  backDays = 10,
): SoonList {
  const ahead = occurrencesBetween(moments, today, addDays(today, aheadDays));
  const weekEnd = addDays(today, 6);
  return {
    today: ahead.filter((o) => o.date === today),
    thisWeek: ahead.filter((o) => o.date > today && o.date <= weekEnd),
    later: ahead.filter((o) => o.date > weekEnd),
    followUps: occurrencesBetween(moments, addDays(today, -backDays), addDays(today, -1)).filter(
      (o) => o.moment.kind === "event" && !asked.has(askKey(o.moment.id, o.date, "after")),
    ),
  };
}
