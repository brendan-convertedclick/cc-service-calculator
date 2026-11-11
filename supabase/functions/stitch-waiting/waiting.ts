// supabase/functions/stitch-waiting/waiting.ts
//
// A client's review list, reduced to what Stitch shows: their rows in "Your
// move", "With us" and "Signed off", each open row with its stop-clock days,
// and the "Who's holding it up" totals. Pure, so it is tested without a DB.
//
// Every rule here is the review page's own: bucketOf/workBucketOf for the
// pane, holdingRows -> stopClock -> summariseStopClocks for the time, summed
// the way HoldingView sums it. Nothing is re-derived. And nothing staff-only
// leaves: each row is built from twelve named fields, never a spread, so the
// ask, the thread and every other column on the list payload stay behind.

import { bucketOf, typeLabelFor, workBucketOf } from "../_shared/client-buckets.ts";
import { holdingRows, type StopClock, stopClock, summariseStopClocks } from "../_shared/stop-clock.ts";
import type { ListPayload } from "../_shared/review-list.ts";

export interface WaitingItem {
  id: string;
  title: string;
  kind: string;
  bucket: "your-move" | "with-us" | "signed-off";
  dueDate: string | null;
  movedTo: string | null;
  clientDays: number | null;
  ourDays: number | null;
  lateOnUs: boolean;
  decidedAt: string | null;
  urgent: boolean;
  path: string;
}

export interface WaitingResult {
  items: WaitingItem[];
  summary?: { clientDays: number; ourDays: number; moved: number; daysLost: number; lateOnUs: number };
}

const DAY_MS = 86_400_000;
const SAST_OFFSET_MS = 2 * 3_600_000;
const SIGNED_OFF_CAP = 20;

/**
 * "YYYY-MM-DD" in South Africa (UTC+2, no DST). The edge runtime is UTC, so a
 * local-getter date would be a day early between 00:00 and 02:00 SAST.
 */
export function sastDate(ms: number): string {
  return new Date(ms + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A bare date plus n days, as a bare date. UTC arithmetic: no timezone can shift it. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function waitingFrom(
  payload: Pick<ListPayload, "items" | "work">,
  today: string,
  now: number,
): WaitingResult {
  const { items, work } = payload;
  // Only open rows get a clock: holdingRows leaves out settled asks and done
  // work, so a missing entry here means "no clock" and the row carries nulls.
  const clocks = new Map<string, StopClock>(
    holdingRows(items, work).map((row) => [row.id, stopClock(row, now)]),
  );
  const urgentBy = addDays(today, 2);

  const row = (
    id: string,
    title: string,
    kind: string,
    bucket: WaitingItem["bucket"],
    dueDate: string | null,
    decidedAt: string | null,
  ): WaitingItem => {
    const clock = bucket === "signed-off" ? undefined : clocks.get(id);
    // UTC on purpose: a due date is a bare date anchored at UTC midnight, as
    // stopClock's dueMs and the review page's formatDueDate both read it.
    const implied = clock?.impliedDueMs == null ? null : new Date(clock.impliedDueMs).toISOString().slice(0, 10);
    return {
      id,
      title,
      kind,
      bucket,
      dueDate,
      movedTo: implied !== null && implied !== dueDate ? implied : null,
      clientDays: clock ? round1(clock.clientDays) : null,
      ourDays: clock ? round1(clock.ourDays) : null,
      lateOnUs: clock?.verdict === "ours",
      decidedAt,
      urgent: bucket === "your-move" && dueDate !== null && dueDate <= urgentBy,
      path: `/launch/signoffs?item=${encodeURIComponent(id)}`,
    };
  };

  const open: WaitingItem[] = [];
  const settled: { at: string | null; row: WaitingItem }[] = [];
  for (const item of items) {
    const bucket = bucketOf(item);
    if (bucket === "coming-up") continue;
    if (bucket === "signed-off") {
      const at = item.decided_at;
      const decidedAt = at ? sastDate(Date.parse(at)) : null;
      settled.push({ at, row: row(item.id, item.client_title, typeLabelFor(item), bucket, item.due_date, decidedAt) });
      continue;
    }
    open.push(row(item.id, item.client_title, typeLabelFor(item), bucket, item.due_date, null));
  }
  for (const w of work) {
    const bucket = workBucketOf(w) as "your-move" | "with-us";
    open.push(row(w.id, w.title, bucket === "your-move" ? "Task with you" : "Our task", bucket, w.due_date, null));
  }

  // Due date ascending, undated last.
  open.sort((a, b) =>
    a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1
  );
  // Newest decision first; ISO timestamps compare as strings.
  settled.sort((a, b) => (a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : a.at < b.at ? 1 : -1));

  // The summary is HoldingView's: summariseStopClocks for what moved, and the
  // two clocks summed over the rows still open.
  const all = [...clocks.values()];
  const s = summariseStopClocks(all);
  const live = all.filter((c) => c.court !== "done");
  return {
    items: [...open, ...settled.slice(0, SIGNED_OFF_CAP).map((x) => x.row)],
    summary: {
      clientDays: round1(live.reduce((a, c) => a + c.clientMs, 0) / DAY_MS),
      ourDays: round1(live.reduce((a, c) => a + c.internalMs, 0) / DAY_MS),
      moved: s.moved,
      daysLost: s.daysLost,
      lateOnUs: s.lateOnUs,
    },
  };
}
