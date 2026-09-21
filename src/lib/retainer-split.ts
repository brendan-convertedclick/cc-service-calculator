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
}

export interface SplitRow {
  key: "retainer" | "adhoc" | "internal";
  label: string;
  hours: number;
  /** Share of the three, 0-100. Zero total gives zero, never NaN. */
  pct: number;
  /** The sub-line under the bar, or null when there is nothing to say. */
  note: string | null;
}

const fmt = (h: number) => `${Math.round(h * 10) / 10}h`;

export function splitHours(input: SplitInput): SplitRow[] {
  const retainer = input.retainer + input.recurring;
  const total = retainer + input.adhoc + input.internal;
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
  ];
}
