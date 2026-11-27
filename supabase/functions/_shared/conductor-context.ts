// supabase/functions/_shared/conductor-context.ts
//
// The pure half of conductor-mcp: matching a sender to a client, summarising a
// retainer month, and naming where a ticket is. No I/O, no Deno, so
// src/lib/conductor-context.test.ts runs it under vitest.
//
// normalizeHost / hostMatches are the same rule as mcp-server/src/domain.ts
// (the laptop MCP). They are copied rather than imported because the edge
// runtime cannot reach that package; keep the two in step.

/** Reduce any URL, host or email address to a bare lowercase host. */
export function normalizeHost(input: string | null | undefined): string {
  if (!input) return "";
  const s = input.trim().toLowerCase();
  const afterAt = s.includes("@") && !s.includes("/") ? s.slice(s.lastIndexOf("@") + 1) : s;
  return afterAt
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/>$/, "");
}

/** True when `senderHost` is `clientHost` or one of its subdomains. Both normalised. */
export function hostMatches(senderHost: string, clientHost: string): boolean {
  if (!senderHost || !clientHost) return false;
  return senderHost === clientHost || senderHost.endsWith("." + clientHost);
}

/** Pull the address out of `"Jane Doe" <jane@acme.co.za>` or return the input. */
export function emailOf(from: string | null | undefined): string {
  const s = String(from ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

export type RetainerMonth = {
  hours_target: number | null;
  hours_used: number;
  burn_pct: number | null;
  days_left: number;
  /** Plain words a brief writer can act on. */
  headline: string;
};

/**
 * The same burn rule as computeRetainerBurn (src/hooks/usePulseRetainerBurn.ts):
 * red at 85%, amber at 70%. Here it becomes one sentence, because the reader is
 * deciding how big a task to brief, not looking at a dashboard.
 */
export function retainerMonth(target: number | null, used: number, today: Date): RetainerMonth {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - today.getDate();
  const hoursUsed = Math.round(used * 10) / 10;
  if (!target) {
    return {
      hours_target: null,
      hours_used: hoursUsed,
      burn_pct: null,
      days_left: daysLeft,
      headline: `${hoursUsed}h logged this month; the retainer has no hours target set.`,
    };
  }
  const pct = Math.round((used / target) * 100);
  const left = Math.round((target - used) * 10) / 10;
  const headline = left <= 0
    ? `Over: ${hoursUsed}h of ${target}h used with ${daysLeft} days left. New work is extra unless something moves.`
    : pct >= 85
    ? `Nearly used: ${left}h of ${target}h left, ${daysLeft} days to go. Keep this small or agree it as extra.`
    : pct >= 70
    ? `${left}h of ${target}h left, ${daysLeft} days to go. Watch the size.`
    : `${left}h of ${target}h left, ${daysLeft} days to go.`;
  return { hours_target: target, hours_used: hoursUsed, burn_pct: pct, days_left: daysLeft, headline };
}

export type TicketStage = "doing" | "handed_over" | "with_client" | "approved" | "changes" | "done";

const DONE = new Set(["complete", "closed", "done"]);

/**
 * Where a briefed task is, from the client's point of view. A sign-off row, if
 * there is one, wins over the ClickUp status: it is the more recent fact.
 */
export function ticketStage(
  clickupStatus: string | null | undefined,
  completedAt: string | null | undefined,
  signoffState: string | null | undefined,
): TicketStage {
  if (signoffState === "parked") return "handed_over";
  if (signoffState === "pending") return "with_client";
  if (signoffState === "changes_requested") return "changes";
  if (signoffState === "approved") return "approved";
  const s = String(clickupStatus ?? "").toLowerCase();
  if (completedAt || DONE.has(s)) return "done";
  return "doing";
}

export const STAGE_LABEL: Record<TicketStage, string> = {
  doing: "Being worked on",
  handed_over: "Handed over, waiting for Send",
  with_client: "With the client for sign-off",
  approved: "Client approved",
  changes: "Client asked for changes",
  done: "Done in ClickUp, no sign-off",
};
