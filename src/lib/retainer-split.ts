// Where the team's hours went: retainer work, ad hoc work, or our own
// (Lisa, 2026-09-21: "to see where the majority of work is ... or what
// percentage in each").
//
// The Book already has a tab per category. This is the one view that reads
// ACROSS them, so the only rule that matters is that it cannot disagree with
// the tabs underneath it: every number here is the same `delivered` total the
// tab shows, added up, never recomputed from the rows.
//
// Two of the four tabs fold, and neither folds silently:
//
//   * Recurring goes inside Retainer. A standing monthly task is client work
//     under a standing fee — it is not ad hoc and it is not ours — so on a
//     three-way split it belongs with the retainer. The recurring part is
//     still reported, because "most of the retainer hours are standing tasks"
//     and "most of them are briefed work" are different months.
//   * Unlinked work sits inside Ad hoc, which is where the Book already puts
//     it, but it is reported too. It is `billing_type = 'retainer'` hanging
//     off no budgeted retainer — retainer work that was briefed against the
//     wrong project. Left unlabelled it reads as ad hoc creeping up when the
//     real story is a routing mistake.
//
// Sales (Lisa, 2026-11-13) is the fourth row, and only shows when there is
// some. It is time on the Outside tab somebody marked as sales (0213): it is
// taken OUT of the ad hoc or internal figure it was sitting in, by the
// caller, so the shares still add up to the same month.

export interface SplitInput {
  /** The Client Retainers tab's Completed total. */
  retainer: number;
  /** The Recurring tab's — folded into retainer, reported separately. */
  recurring: number;
  /** The Ad Hoc tab's. */
  adhoc: number;
  /** The part of adhoc that is really unbooked retainer work. */
  adhocUnlinked: number;
  /** The Internal tab's. */
  internal: number;
  /** Hours marked as sales on the Outside tab, already taken out of adhoc / internal. */
  sales: number;
}

export interface SplitRow {
  key: "retainer" | "adhoc" | "internal" | "sales";
  label: string;
  hours: number;
  /** Share of the month, 0-100. Zero total gives zero, never NaN. */
  pct: number;
  /** The sub-line under the bar, or null when there is nothing to say. */
  note: string | null;
}

const fmt = (h: number) => `${Math.round(h * 10) / 10}h`;

export function splitHours(input: SplitInput): SplitRow[] {
  const retainer = input.retainer + input.recurring;
  const total = retainer + input.adhoc + input.internal + input.sales;
  const pct = (h: number) => (total > 0 ? (h / total) * 100 : 0);

  return [
    {
      key: "retainer",
      label: "Retainer work",
      hours: retainer,
      pct: pct(retainer),
      note: input.recurring > 0
        ? `includes ${fmt(input.recurring)} of standing monthly tasks`
        : null,
    },
    {
      key: "adhoc",
      label: "Ad hoc work",
      hours: input.adhoc,
      pct: pct(input.adhoc),
      note: input.adhocUnlinked > 0
        ? `includes ${fmt(input.adhocUnlinked)} of retainer work with no retainer to book it to`
        : null,
    },
    {
      key: "internal",
      label: "Our own work",
      hours: input.internal,
      pct: pct(input.internal),
      note: null,
    },
    ...(input.sales > 0
      ? [{ key: "sales" as const, label: "Sales", hours: input.sales, pct: pct(input.sales), note: null }]
      : []),
  ];
}

/** Outside-tab rows marked as sales, split by where the Book had counted them. */
export interface SalesMarked {
  /** Booked to no retainer, so the Book has them in ad hoc (as unlinked work). */
  fromAdhoc: Map<string, number>;
  /** A brief marked Internal on a paying client, so the Book has it in internal. */
  fromInternal: Map<string, number>;
}

export function salesMarked(
  rows: Array<{ client_name: string; reason: string; hours: number | string; dismissed_kind: string | null }>,
): SalesMarked {
  const out: SalesMarked = { fromAdhoc: new Map(), fromInternal: new Map() };
  for (const r of rows) {
    if (r.dismissed_kind !== "sales") continue;
    // Only time that would otherwise be hidden can be marked, so the reason is
    // one of internal / meeting / unlinked / ongoing.
    const m = r.reason === "internal" ? out.fromInternal : out.fromAdhoc;
    m.set(r.client_name, (m.get(r.client_name) ?? 0) + (Number(r.hours) || 0));
  }
  return out;
}
