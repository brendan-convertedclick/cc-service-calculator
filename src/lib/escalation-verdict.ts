import { pointsToHours } from "@/lib/sprint-points";

/**
 * The verdict is the sentence the escalations pane opens with. It exists so an
 * owner reads the call before the evidence, and reads it the same way on the
 * tenth request as on the first.
 *
 * Pure on purpose: the wording is the product decision, so it's testable
 * without a browser and can't drift between the rail and the detail pane.
 */

export type VerdictTone = "ok" | "warn" | "danger" | "mute";
export type VerdictFlag = { tone: VerdictTone; label: string };

export type VerdictInput = {
  requesterName: string | null;
  clientName: string | null;
  /** Extra sprint points asked for; null on a date-only request. */
  extraPoints: number | null;
  originalPoints: number | null;
  /** Points burned against the task so far. null when ClickUp hasn't answered. */
  pointsConsumed: number | null;
  originalDueDate: string | null;
  requestedDueDate: string | null;
  /** From the brief. null means the task has no brief, so nobody knows. */
  billing: "retainer" | "adhoc" | null;
  /**
   * Whether the billing lookup has come back. False while it's in flight —
   * the verdict then says nothing about who pays rather than asserting
   * "there is no brief", which is a claim, not a blank.
   */
  billingResolved: boolean;
  /** Client retainer burn % once this request is absorbed. null if no retainer. */
  burnPctAfter: number | null;
  /** Other overruns raised for this client in the current month. */
  priorOverrunsThisMonth: number;
  /** True when the task's own hours never reach the retainer figures. */
  hoursMissingFromBurn: boolean;
};

export type Verdict = {
  headline: string;
  flags: VerdictFlag[];
};

/** First name only — the sentence reads as a colleague speaking, not a system. */
function firstName(full: string | null): string {
  const n = (full ?? "").trim();
  if (!n) return "Someone";
  return n.split(/\s+/)[0];
}

export function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function consumedPct(consumed: number | null, budget: number | null): number | null {
  if (consumed === null || budget === null || budget <= 0) return null;
  return Math.round((consumed / budget) * 100);
}

/** "10 more points" / "1 more point" — prose, so no `pt` abbreviation. */
function morePoints(n: number): string {
  return `${n} more ${n === 1 ? "point" : "points"}`;
}

function moreDays(n: number): string {
  return `${n} more ${n === 1 ? "day" : "days"}`;
}

/** Attributive form: "its 4-point budget". */
function pointBudget(n: number): string {
  return `${n}-point`;
}

/**
 * How the overrun is described. Kept separate because a task with no points
 * budget can't be over anything, and saying "0% of its 0-point budget" is
 * worse than saying nothing.
 */
function overrunClause(input: VerdictInput): string {
  const pct = consumedPct(input.pointsConsumed, input.originalPoints);
  if (pct === null) return "";
  if (pct >= 100) {
    return ` on a task that has already burned ${pct}% of its ${pointBudget(input.originalPoints!)} budget`;
  }
  return ` on a task that has used ${pct}% of its ${pointBudget(input.originalPoints!)} budget`;
}

function billingClause(input: VerdictInput): string {
  if (!input.billingResolved) return "";
  const client = input.clientName ?? "the client";
  if (input.billing === "retainer") {
    return ` ${client}'s retainer absorbs it — no invoice changes.`;
  }
  if (input.billing === "adhoc") {
    return ` It's ad-hoc work, so approving it is separately billable to ${client}.`;
  }
  return ` There's no brief in Conductor for this task, so who pays for it can't be determined.`;
}

export function buildVerdict(input: VerdictInput): Verdict {
  const who = firstName(input.requesterName);
  const dayCount = daysBetween(input.originalDueDate, input.requestedDueDate);
  const hasPoints = input.extraPoints !== null && input.extraPoints > 0;
  const hasDate = input.requestedDueDate !== null;

  let ask: string;
  if (hasPoints && hasDate && dayCount !== null) {
    ask = `${who} needs ${morePoints(input.extraPoints!)} and ${moreDays(dayCount)}`;
  } else if (hasPoints) {
    ask = `${who} needs ${morePoints(input.extraPoints!)}`;
  } else if (hasDate && dayCount !== null) {
    ask = `${who} wants ${moreDays(dayCount)}`;
  } else if (hasDate) {
    ask = `${who} wants to move the due date`;
  } else {
    ask = `${who} has raised a request`;
  }

  const headline = `${ask}${overrunClause(input)}.${billingClause(input)}`;

  return { headline, flags: buildFlags(input) };
}

function buildFlags(input: VerdictInput): VerdictFlag[] {
  const flags: VerdictFlag[] = [];

  // What it costs, always first — it's the question the sentence answers last.
  // Nothing at all until the lookup resolves; a "unknown" badge on a task that
  // does have a brief is a false statement, not a placeholder.
  if (input.billingResolved) {
    if (input.billing === "retainer") {
      flags.push({ tone: "ok", label: "Costs nothing extra" });
    } else if (input.billing === "adhoc") {
      flags.push({ tone: "warn", label: "Separately billable" });
    } else {
      flags.push({ tone: "mute", label: "Billing unknown" });
    }
  }

  // A date push that asks for no points funds nothing on a task that is
  // already over. Naming the number is the whole reason this flag exists —
  // and it stays true whether the zero was stated or the row predates the
  // budget field being mandatory, so the label doesn't accuse either way.
  const unfunded =
    (input.extraPoints === null || input.extraPoints === 0) &&
    input.pointsConsumed !== null &&
    input.originalPoints !== null &&
    input.pointsConsumed > input.originalPoints
      ? Math.round((input.pointsConsumed - input.originalPoints) * 100) / 100
      : null;
  if (unfunded !== null) {
    const hrs = Math.round(pointsToHours(unfunded) * 10) / 10;
    flags.push({ tone: "danger", label: `${unfunded} pt · ${hrs}h already over, unfunded` });
  }

  if (input.priorOverrunsThisMonth > 0) {
    const n = input.priorOverrunsThisMonth + 1;
    flags.push({ tone: "danger", label: `${ordinal(n)} overrun for this client this month` });
  }

  if (input.burnPctAfter !== null && input.burnPctAfter >= 85) {
    flags.push({ tone: "danger", label: `Retainer at ${input.burnPctAfter}% after this` });
  }

  if (input.hoursMissingFromBurn) {
    flags.push({ tone: "warn", label: "Retainer figures understated" });
  }

  return flags;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
