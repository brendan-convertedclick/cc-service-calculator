// Work for a retainer client that lands on none of its retainers (0207).
// retainer_outside_work returns one row per task; this groups it per client.

export type OutsideReason = "meeting" | "internal" | "unlinked" | "ongoing" | "adhoc" | "open_retainer" | "archived";

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
}

/** Hidden: nobody sees it against a budget and nobody bills it. Ad hoc is billed. Archived is a sync gap. */
export type OutsideKind = "hidden" | "adhoc" | "archived";

export const OUTSIDE_KIND: Record<OutsideReason, OutsideKind> = {
  meeting: "hidden",
  internal: "hidden",
  unlinked: "hidden",
  ongoing: "hidden",
  adhoc: "adhoc",
  open_retainer: "adhoc",
  archived: "archived",
};

export const OUTSIDE_REASON_LABEL: Record<OutsideReason, string> = {
  meeting: "Meeting with no retainer",
  internal: "Client work marked Internal",
  unlinked: "Brief not linked to a retainer",
  ongoing: "Ongoing bucket with no retainer",
  adhoc: "Ad hoc, invoice separately",
  open_retainer: "On a retainer with no budget",
  archived: "Brief archived, so the book drops it",
};

/** Only these can be booked to a retainer from the tab. Ad hoc is billed on its own; an archived brief has to be reopened. */
export const canBook = (r: OutsideRow) =>
  OUTSIDE_KIND[r.reason] === "hidden" && Boolean(r.brief_id || r.meeting_id || r.ongoing_task_id);

export interface OutsideClient {
  clientId: string;
  clientName: string;
  hidden: number;
  adhoc: number;
  archived: number;
  total: number;
  rows: OutsideRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per client, most hidden time first; rows inside a client largest first. */
export function groupOutside(rows: OutsideRow[]): OutsideClient[] {
  const by = new Map<string, OutsideClient>();
  for (const r of rows) {
    const c = by.get(r.client_id) ?? {
      clientId: r.client_id, clientName: r.client_name, hidden: 0, adhoc: 0, archived: 0, total: 0, rows: [],
    };
    const h = Number(r.hours) || 0;
    c[OUTSIDE_KIND[r.reason] ?? "hidden"] += h;
    c.total += h;
    c.rows.push(r);
    by.set(r.client_id, c);
  }
  return [...by.values()]
    .map((c) => ({
      ...c,
      hidden: r2(c.hidden), adhoc: r2(c.adhoc), archived: r2(c.archived), total: r2(c.total),
      rows: [...c.rows].sort((a, b) => Number(b.hours) - Number(a.hours)),
    }))
    .sort((a, b) => b.hidden - a.hidden || b.total - a.total);
}
