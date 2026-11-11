import { assertEquals } from "jsr:@std/assert";
import { bucketCounts } from "../_shared/client-buckets.ts";
import { holdingRows, stopClock, summariseStopClocks } from "../_shared/stop-clock.ts";
import type { ReviewItem, ReviewWork } from "../_shared/review-list.ts";
import { sastDate, waitingFrom } from "./waiting.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T10:00:00Z");
const TODAY = "2026-11-10";

let seq = 0;
function item(over: Partial<ReviewItem> = {}): ReviewItem {
  seq += 1;
  return {
    id: `i-${seq}`,
    item_type: "brief",
    client_title: `Item ${seq}`,
    ask: "SECRET ASK TEXT",
    detail: null,
    due_date: null,
    weighty: false,
    state: "pending",
    decided_at: null,
    decided_by_name: null,
    agreed_at: null,
    agreed_via: null,
    owed_by: "client",
    waiting_ms: null,
    our_ms: null,
    court: null,
    work_since: null,
    links: [],
    emailed_at: null,
    moves: [],
    messages: [{ id: "m", from: "us", author: null, body: "SECRET THREAD", at: "2026-11-01T00:00:00Z" }],
    created_at: "2026-11-01T08:00:00Z",
    raised_by: "us",
    raised_by_name: null,
    client_note: null,
    ...over,
  };
}

function work(over: Partial<ReviewWork> = {}): ReviewWork {
  seq += 1;
  return {
    id: `w-${seq}`,
    title: `Task ${seq}`,
    court: "us",
    waiting_ms: 0,
    our_ms: DAY,
    work_since: "2026-10-01T00:00:00Z",
    due_date: null,
    ...over,
  };
}

// A linked task: briefed, now back with us, the client held it 3 days.
const linked = item({
  court: "us",
  work_since: "2026-10-20T00:00:00Z",
  waiting_ms: 3 * DAY,
  our_ms: 2 * DAY,
  due_date: "2026-11-20",
});
const unlinkedAsk = item({ item_type: "question", due_date: "2026-11-12" });
const items: ReviewItem[] = [
  linked,
  unlinkedAsk,
  item({ item_type: "agreement", owed_by: "us" }),
  item({ state: "changes_requested", decided_at: "2026-11-05T09:00:00Z" }),
  item({ item_type: "event", state: "noted", due_date: "2026-12-01" }),
  ...Array.from({ length: 22 }, (_, i) =>
    item({ state: "approved", decided_at: new Date(Date.parse("2026-10-01T12:00:00Z") + i * DAY).toISOString() })
  ),
];
const workRows: ReviewWork[] = [
  work({ court: "client", waiting_ms: 2 * DAY, due_date: "2026-11-13" }),
  work({ court: "us", due_date: "2026-11-30" }),
  work({ court: "done" }),
];

const result = waitingFrom({ items, work: workRows }, TODAY, NOW);
const byId = new Map(result.items.map((r) => [r.id, r]));
const round1 = (n: number) => Math.round(n * 10) / 10;

Deno.test("your-move and with-us rows number exactly what bucketCounts says", () => {
  const counts = bucketCounts(items, workRows);
  assertEquals(result.items.filter((r) => r.bucket === "your-move").length, counts["your-move"]);
  assertEquals(result.items.filter((r) => r.bucket === "with-us").length, counts["with-us"]);
});

Deno.test("no coming-up row; at most 20 signed-off rows, newest first, with null clocks", () => {
  assertEquals(result.items.some((r) => (r.bucket as string) === "coming-up"), false);
  const signed = result.items.filter((r) => r.bucket === "signed-off");
  assertEquals(signed.length, 20);
  for (const r of signed) {
    assertEquals([r.clientDays, r.ourDays, r.movedTo], [null, null, null]);
    assertEquals(r.lateOnUs, false);
  }
  assertEquals(signed[0].decidedAt, "2026-10-22");
  const dates = signed.map((r) => r.decidedAt!);
  assertEquals([...dates].sort().reverse(), dates);
});

Deno.test("a linked task's days equal stopClock on the same row, and its date moved", () => {
  const row = holdingRows(items, workRows).find((r) => r.id === linked.id)!;
  const clock = stopClock(row, NOW);
  const out = byId.get(linked.id)!;
  assertEquals(out.clientDays, round1(clock.clientDays));
  assertEquals(out.ourDays, round1(clock.ourDays));
  assertEquals(out.clientDays, 3);
  assertEquals(out.movedTo, "2026-11-23");
  assertEquals(byId.get(unlinkedAsk.id)!.movedTo, null);
});

Deno.test("summary equals summariseStopClocks and HoldingView's open sums", () => {
  const clocks = holdingRows(items, workRows).map((r) => stopClock(r, NOW));
  const s = summariseStopClocks(clocks);
  assertEquals(result.summary!.daysLost, s.daysLost);
  assertEquals(result.summary!.moved, s.moved);
  assertEquals(result.summary!.lateOnUs, s.lateOnUs);
  const open = clocks.filter((c) => c.court !== "done");
  assertEquals(result.summary!.clientDays, round1(open.reduce((a, c) => a + c.clientMs, 0) / DAY));
  assertEquals(result.summary!.ourDays, round1(open.reduce((a, c) => a + c.internalMs, 0) / DAY));
});

Deno.test("done briefed work stays in with-us with null clocks", () => {
  const done = byId.get(workRows[2].id)!;
  assertEquals(done.bucket, "with-us");
  assertEquals(done.kind, "Our task");
  assertEquals([done.clientDays, done.ourDays], [null, null]);
  assertEquals(byId.get(workRows[0].id)!.kind, "Task with you");
});

Deno.test("no due date: dueDate null, urgent false", () => {
  const r = waitingFrom({ items: [item()], work: [] }, TODAY, NOW).items[0];
  assertEquals([r.dueDate, r.urgent], [null, false]);
});

Deno.test("due today+2 is urgent, today+3 is not; urgent is your-move only", () => {
  const [a, b, c] = [
    item({ due_date: "2026-11-12" }),
    item({ due_date: "2026-11-13" }),
    item({ owed_by: "us", due_date: "2026-11-01" }),
  ];
  const out = new Map(waitingFrom({ items: [a, b, c], work: [] }, TODAY, NOW).items.map((r) => [r.id, r]));
  assertEquals(out.get(a.id)!.urgent, true);
  assertEquals(out.get(b.id)!.urgent, false);
  assertEquals(out.get(c.id)!.bucket, "with-us");
  assertEquals(out.get(c.id)!.urgent, false);
});

Deno.test("every row has exactly the twelve spec keys, and no staff text", () => {
  const keys = [
    "bucket", "clientDays", "decidedAt", "dueDate", "id", "kind", "lateOnUs", "movedTo", "ourDays", "path",
    "title", "urgent",
  ];
  for (const r of result.items) assertEquals(Object.keys(r).sort(), keys);
  const wire = JSON.stringify(result);
  assertEquals(wire.includes("SECRET"), false);
  assertEquals(byId.get(linked.id)!.path, `/launch/signoffs?item=${linked.id}`);
  assertEquals(byId.get(workRows[0].id)!.path, `/launch/signoffs?item=${workRows[0].id}`);
});

Deno.test("open rows sort by due date, nulls last", () => {
  const open = result.items.filter((r) => r.bucket !== "signed-off").map((r) => r.dueDate);
  const dated = open.filter((d) => d !== null);
  assertEquals(open.slice(0, dated.length), [...dated].sort());
  assertEquals(open.slice(dated.length).every((d) => d === null), true);
});

Deno.test("lateOnUs is the clock's own verdict: a client-held overrun is not late on us", () => {
  const due = new Date(NOW - 13 * DAY).toISOString().slice(0, 10);
  const held = work({ court: "us", waiting_ms: 10 * DAY, due_date: due });
  const ours = work({ court: "us", waiting_ms: 0, due_date: due });
  const out = new Map(waitingFrom({ items: [], work: [held, ours] }, TODAY, NOW).items.map((r) => [r.id, r]));
  const rows = holdingRows([], [held, ours]);
  for (const r of rows) assertEquals(out.get(r.id)!.lateOnUs, stopClock(r, NOW).verdict === "ours");
  assertEquals(out.get(held.id)!.lateOnUs, false);
  assertEquals(out.get(ours.id)!.lateOnUs, true);
});

Deno.test("sastDate: 23:30 UTC is already tomorrow in SAST", () => {
  assertEquals(sastDate(Date.parse("2026-11-02T23:30:00Z")), "2026-11-03");
  assertEquals(sastDate(Date.parse("2026-11-02T21:59:00Z")), "2026-11-02");
});
