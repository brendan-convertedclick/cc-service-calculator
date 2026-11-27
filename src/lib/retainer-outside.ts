// Work for a retainer client that lands on none of its retainers (0207, 0211).
// retainer_outside_work returns one row per task; this groups it per client.

export type OutsideReason =
  | "meeting"
  | "internal"
  | "unlinked"
  | "ongoing"
  | "adhoc"
  | "open_retainer"
  | "archived"
  | "clickup_only";

export interface OutsideRow {
  client_id: string;
  client_name: string;
  clickup_task_id: string;
  task_name: string | null;
  reason: OutsideReason;
  hours: number | string;
  brief_id: string | null;
  brief_billing_type: string | null;
  meeting_id: string | null;
  ongoing_task_id: string | null;
  dismissed_at: string | null;
  dismissed_by_name: string | null;
  /** What it was confirmed as (0213): ours, or sales. Null while undismissed. */
  dismissed_kind: DismissKind | null;
}

export type DismissKind = "internal" | "sales";

/**
 * The columns of the per-client table. The first three are leaks (time lost
 * unless it is booked to a retainer) and sum to the hidden total; ad hoc is
 * billable and only needs invoicing; archived is shown for reference, since
 * its fix is reopening the brief, not booking it.
 */
export type OutsideColumn =
  "internal" | "meeting" | "other" | "adhoc" | "archived";

export const OUTSIDE_COLUMN: Record<OutsideReason, OutsideColumn> = {
  internal: "internal",
  meeting: "meeting",
  unlinked: "other",
  ongoing: "other",
  adhoc: "adhoc",
  open_retainer: "adhoc",
  archived: "archived",
  clickup_only: "other",
};

const HIDDEN: OutsideColumn[] = ["internal", "meeting", "other"];
export const isHidden = (r: OutsideRow) =>
  HIDDEN.includes(OUTSIDE_COLUMN[r.reason]);

export const OUTSIDE_REASON_LABEL: Record<OutsideReason, string> = {
  meeting: "Meeting with no retainer",
  internal: "Client work marked Internal",
  unlinked: "Brief not linked to a retainer",
  ongoing: "Ongoing bucket with no retainer",
  adhoc: "Ad hoc, invoice separately",
  open_retainer: "On a retainer with no budget",
  archived: "Brief archived, so the book drops it",
  clickup_only: "ClickUp task with no brief",
};

/**
 * Booking and dismissing are for leaks with a Conductor record behind them,
 * or a ClickUp-only task, which booking gives a brief first.
 */
export const canBook = (r: OutsideRow) =>
  isHidden(r) &&
  !r.dismissed_at &&
  Boolean(r.brief_id || r.meeting_id || r.ongoing_task_id || r.reason === "clickup_only");

/** Only a brief can become ad hoc: a meeting or bucket has no billing type of its own. */
export const canConvertToAdhoc = (r: OutsideRow) =>
  isHidden(r) && !r.dismissed_at && Boolean(r.brief_id);

export const ADHOC_PREFIX = "[Ad Hoc] ";
export const adhocName = (name: string) =>
  name.startsWith(ADHOC_PREFIX) ? name : `${ADHOC_PREFIX}${name}`;

export interface OutsideTotals {
  internal: number;
  meeting: number;
  other: number;
  hidden: number;
  adhoc: number;
  archived: number;
  dismissed: number;
  sales: number;
}

export interface OutsideClient extends OutsideTotals {
  clientId: string;
  clientName: string;
  rows: OutsideRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): OutsideTotals => ({
  internal: 0,
  meeting: 0,
  other: 0,
  hidden: 0,
  adhoc: 0,
  archived: 0,
  dismissed: 0,
  sales: 0,
});

function add(t: OutsideTotals, r: OutsideRow) {
  const h = Number(r.hours) || 0;
  // The columns show all the month's time, confirmed internal or not (Lisa,
  // 2026-11-13); only the hidden total drops what has been confirmed.
  const col = OUTSIDE_COLUMN[r.reason] ?? "other";
  t[col] += h;
  if (r.dismissed_at) t[r.dismissed_kind === "sales" ? "sales" : "dismissed"] += h;
  else if (HIDDEN.includes(col)) t.hidden += h;
}

const round = <T extends OutsideTotals>(t: T): T => {
  for (const k of Object.keys(zero()) as Array<keyof OutsideTotals>)
    t[k] = r2(t[k]);
  return t;
};

/** Per client, most hidden time first; rows inside a client largest first. Dismissed time stays in its column but not in hidden. */
export function groupOutside(rows: OutsideRow[]): OutsideClient[] {
  const by = new Map<string, OutsideClient>();
  for (const r of rows) {
    const c = by.get(r.client_id) ?? {
      clientId: r.client_id,
      clientName: r.client_name,
      rows: [],
      ...zero(),
    };
    add(c, r);
    c.rows.push(r);
    by.set(r.client_id, c);
  }
  return [...by.values()]
    .map((c) =>
      round({
        ...c,
        rows: [...c.rows].sort((a, b) => Number(b.hours) - Number(a.hours)),
      }),
    )
    .sort((a, b) => b.hidden - a.hidden || b.adhoc - a.adhoc);
}

/** The month's headline: every column summed across clients. */
export function totalOutside(clients: OutsideClient[]): OutsideTotals {
  const t = zero();
  for (const c of clients)
    for (const k of Object.keys(t) as Array<keyof OutsideTotals>) t[k] += c[k];
  return round(t);
}
