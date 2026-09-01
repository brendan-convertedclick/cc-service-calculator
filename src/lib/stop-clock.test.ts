import { describe, expect, it } from "vitest";
import {
  formatDays,
  stopClock,
  summariseStopClocks,
  type StopClockSource,
} from "@/lib/stop-clock";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-31T00:00:00Z");

function task(over: Partial<StopClockSource> = {}): StopClockSource {
  return {
    clickup_task_status: "waiting on client",
    clickup_status_synced_at: "2026-08-31T00:00:00Z",
    client_wait_ms: 0,
    internal_wait_ms: 0,
    completed_at: null,
    original_due_date: "2026-08-30",
    created_at: "2026-08-01T00:00:00Z",
    original_points: 4, // 1 hour
    ...over,
  };
}

describe("stopClock", () => {
  it("moves the date by the days the client held it", () => {
    // The real Kings College row: raised 23 Jul, due 30 Jul, 38.25d with them.
    const c = stopClock(
      task({
        created_at: "2026-07-23T00:00:00Z",
        original_due_date: "2026-07-30",
        client_wait_ms: 38.25 * DAY,
        internal_wait_ms: 0.96 * DAY,
      }),
      NOW,
    );
    expect(c.runwayDays).toBe(7);
    // 32 days past its own date — the number the tab shows today...
    expect(Math.round(c.pastDueDays)).toBe(32);
    // ...and none of it survives once their days come off.
    expect(c.lateDays).toBe(0);
    expect(c.verdict).toBe("on-track");
    expect(new Date(c.impliedDueMs!).toISOString().slice(0, 10)).toBe("2026-09-06");
  });

  it("KEEPS BOTH COUNTS — showing only the survivor would be an excuse", () => {
    const c = stopClock(
      task({ original_due_date: "2026-08-01", client_wait_ms: 10 * DAY }),
      NOW,
    );
    expect(c.pastDueDays).toBeGreaterThan(0);
    expect(c.lateDays).toBeGreaterThan(0);
    // 30 days past its date, 10 of them theirs, so 20 remain ours.
    expect(Math.round(c.pastDueDays)).toBe(30);
    expect(Math.round(c.lateDays)).toBe(20);
  });

  it("NEVER moves a date for queued time — that is the whole credibility of it", () => {
    // The boosted-posts row: 25 days sitting in Planned, no client wait.
    const c = stopClock(
      task({
        clickup_task_status: "planned",
        created_at: "2026-08-06T00:00:00Z",
        original_due_date: "2026-08-07",
        client_wait_ms: 0,
        internal_wait_ms: 25.17 * DAY,
      }),
      NOW,
    );
    expect(c.impliedDueMs).toBe(c.dueMs);
    expect(Math.round(c.lateDays)).toBe(24);
    expect(c.verdict).toBe("ours");
  });

  it("does not invent a runway for a row whose date had already passed", () => {
    // Sign-offs drafted from an old ClickUp task carry that task's due date.
    const c = stopClock(
      task({ created_at: "2026-08-28T00:00:00Z", original_due_date: "2026-07-31" }),
      NOW,
    );
    expect(c.bornLate).toBe(true);
    expect(c.runwayDays).toBeNull();
  });

  it("calls it tight when the runway left is under the work left", () => {
    const c = stopClock(
      task({
        created_at: "2026-08-20T00:00:00Z",
        original_due_date: "2026-08-31",
        client_wait_ms: 0.4 * DAY, // under half a day — not enough to move it
        original_points: 96, // 24 hours = 4 working days
      }),
      NOW,
    );
    expect(c.verdict).toBe("tight");
  });

  it("adds the still-running clock, so a task sent an hour ago is not zero", () => {
    const c = stopClock(
      task({ client_wait_ms: 0, clickup_status_synced_at: "2026-08-30T00:00:00Z" }),
      NOW,
    );
    expect(c.clientDays).toBeCloseTo(1, 5);
  });

  it("treats a closed task as history, whatever its dates say", () => {
    const c = stopClock(
      task({ completed_at: "2026-08-20T00:00:00Z", original_due_date: "2026-08-01" }),
      NOW,
    );
    expect(c.verdict).toBe("delivered");
  });
});

describe("summariseStopClocks", () => {
  const clocks = [
    stopClock(task({ client_wait_ms: 10 * DAY, original_due_date: "2026-09-10" }), NOW),
    stopClock(task({ client_wait_ms: 3 * DAY, original_due_date: "2026-09-02" }), NOW),
    // ours, past due, no client wait — must not be counted as days lost
    stopClock(
      task({
        clickup_task_status: "planned",
        client_wait_ms: 0,
        internal_wait_ms: 9 * DAY,
        original_due_date: "2026-08-20",
      }),
      NOW,
    ),
  ];

  it("counts only the rows whose date actually moved", () => {
    const s = summariseStopClocks(clocks);
    expect(s.moved).toBe(2);
    expect(Math.round(s.daysLost)).toBe(13);
  });

  it("reports what is late on us separately rather than burying it", () => {
    expect(summariseStopClocks(clocks).lateOnUs).toBe(1);
  });

  it("leads on the row that lost the most, not the one with the soonest date", () => {
    const s = summariseStopClocks(clocks);
    // 10 days held beats 3, even though 3's adjusted date lands sooner.
    expect(s.leadIndex).toBe(0);
  });

  it("never leads on a row whose date had already passed when it was raised", () => {
    // Drafted from an old ClickUp task: due 31 Jul, only found on 28 Aug. Its
    // adjusted date is the soonest of the lot and it means nothing.
    const born = stopClock(
      task({
        created_at: "2026-08-28T00:00:00Z",
        original_due_date: "2026-07-31",
        client_wait_ms: 3 * DAY,
      }),
      NOW,
    );
    const s = summariseStopClocks([born, ...clocks]);
    expect(s.moved).toBe(3); // its days still count
    expect(s.leadIndex).toBe(1); // but it does not lead
  });
});

describe("formatDays", () => {
  it("keeps a decimal below ten so a short wait does not read as nothing", () => {
    expect(formatDays(3.24)).toBe("3.2d");
    expect(formatDays(32.4)).toBe("32d");
  });
});
