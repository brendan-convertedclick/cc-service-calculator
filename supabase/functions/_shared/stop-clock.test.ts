import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  courtOf,
  holdingRows,
  stopClock,
  summariseStopClocks,
  type StopClockSource,
} from "./stop-clock.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-20T00:00:00Z");

const linked: StopClockSource = {
  court: "us",
  client_wait_ms: 3 * DAY,
  internal_wait_ms: 1 * DAY,
  clickup_status_synced_at: null,
  original_due_date: "2026-08-10",
  created_at: "2026-08-01T00:00:00Z",
  original_points: null,
};

Deno.test("stopClock: a linked task with 3 banked client days moves its due date by 3 days", () => {
  const c = stopClock(linked, NOW);
  assertEquals(c.impliedDueMs, Date.parse("2026-08-10T00:00:00Z") + 3 * DAY);
  assertEquals(c.clientDays, 3);
});

Deno.test("stopClock: an unlinked ask (stop_clock false) does not move its date", () => {
  const c = stopClock({ ...linked, stop_clock: false }, NOW);
  assertEquals(c.impliedDueMs, c.dueMs);
  assertEquals(summariseStopClocks([c]).moved, 0);
});

Deno.test("courtOf: waiting statuses are the client's, done wins", () => {
  assertEquals(courtOf({ clickup_task_status: "Waiting on Client", completed_at: null }), "client");
  assertEquals(courtOf({ clickup_task_status: "in progress", completed_at: null }), "us");
  assertEquals(courtOf({ clickup_task_status: "waiting on client", completed_at: "2026-08-01" }), "done");
});

const item = {
  id: "i1",
  client_title: "Logo options",
  state: "pending",
  owed_by: "client" as const,
  court: null,
  work_since: null,
  waiting_ms: null,
  our_ms: null,
  due_date: "2026-08-15",
  agreed_at: null,
  emailed_at: "2026-08-05T00:00:00Z",
  created_at: "2026-08-01T00:00:00Z",
};

Deno.test("holdingRows skips done work and settled items", () => {
  const rows = holdingRows(
    [item, { ...item, id: "i2", state: "approved" }, { ...item, id: "i3", state: "noted" }],
    [
      { id: "w1", title: "Site", court: "client", waiting_ms: 1, our_ms: 2, work_since: "2026-08-01T00:00:00Z", due_date: null },
      { id: "w2", title: "Done", court: "done", waiting_ms: 1, our_ms: 2, work_since: "2026-08-01T00:00:00Z", due_date: null },
    ],
  );
  assertEquals(rows.map((r) => r.id), ["w1", "i1"]);
});

Deno.test("holdingRows: an unlinked ask runs from when it landed and never moves its date", () => {
  const [row] = holdingRows([item]);
  assertEquals(row.stop_clock, false);
  assertEquals(row.court, "client");
  assertEquals(row.clickup_status_synced_at, "2026-08-05T00:00:00Z");
});
