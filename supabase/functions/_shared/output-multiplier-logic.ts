export type Period = "year" | "month" | "week";

export interface PeriodRange {
  startDate: string; // ISO date, inclusive
  endDate: string;   // ISO date, exclusive
  label: string;
}

/** ISO date string from a Date (local time, not UTC) */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week number (1–53) */
function isoWeek(d: Date): number {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  return Math.floor(diff / (7 * 86400000)) + 1;
}

export function periodRange(view: Period, date: string): PeriodRange {
  // Parse as local date to avoid UTC-offset shifting (ISO strings parse as UTC by default)
  const [y, mo, da] = date.split("-").map(Number);
  const d = new Date(y, mo - 1, da);

  if (view === "year") {
    const y = d.getFullYear();
    return {
      startDate: `${y}-01-01`,
      endDate: `${y + 1}-01-01`,
      label: String(y),
    };
  }

  if (view === "month") {
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    const label = start.toLocaleString("en-ZA", { month: "long", year: "numeric" });
    return { startDate: toIso(start), endDate: toIso(end), label };
  }

  // week: Mon–Sun ISO week
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  const week = isoWeek(mon);
  return {
    startDate: toIso(mon),
    endDate: toIso(nextMon),
    label: `W${week} ${mon.getFullYear()}`,
  };
}

/**
 * Output multiplier: total effective output per human hour invested.
 * Formula: (human_hours + ai_session_hours) / human_hours, capped at 20×.
 */
export function computeMultiplier(humanHours: number, aiSessionHours: number): number {
  if (humanHours <= 0) return 1;
  const raw = (humanHours + aiSessionHours) / humanHours;
  return Math.min(raw, 20);
}
