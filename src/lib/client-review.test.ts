import { describe, it, expect } from "vitest";
import { toISODate } from "./dates";
import {
  bucketOf,
  bucketCounts,
  daysOverdue,
  formatAsAt,
  isOverdue,
  sortForQueue,
} from "./client-review";
import type { ReviewItem, ReviewItemState } from "@/types/client-review";

/** Dates are built relative to today so these never rot at midnight. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function item(over: Partial<ReviewItem> & { id: string }): ReviewItem {
  return {
    client_title: `Item ${over.id}`,
    ask: "Sign this off",
    detail: null,
    due_date: null,
    weighty: false,
    state: "pending" as ReviewItemState,
    decided_at: null,
    decided_by_name: null,
    ...over,
  };
}

describe("bucketOf", () => {
  it("routes by who has to act next", () => {
    expect(bucketOf(item({ id: "a", state: "pending" }))).toBe("your-move");
    expect(
      bucketOf(item({ id: "b", state: "changes_requested", decided_at: "2026-08-20T09:00:00Z" })),
    ).toBe("with-us");
    expect(
      bucketOf(item({ id: "c", state: "approved", decided_at: "2026-08-20T09:00:00Z" })),
    ).toBe("signed-off");
  });
});

describe("isOverdue", () => {
  it("is true only while undecided and past due", () => {
    expect(isOverdue(item({ id: "a", due_date: daysFromToday(-3) }))).toBe(true);
    expect(isOverdue(item({ id: "b", due_date: daysFromToday(3) }))).toBe(false);
    expect(isOverdue(item({ id: "c", due_date: daysFromToday(0) }))).toBe(false);
    expect(isOverdue(item({ id: "d", due_date: null }))).toBe(false);
  });

  it("never reproaches a client for an item they already decided", () => {
    const answered = item({
      id: "e",
      due_date: daysFromToday(-31),
      state: "approved",
      decided_at: "2026-08-24T07:00:00Z",
    });
    expect(isOverdue(answered)).toBe(false);
    expect(daysOverdue(answered)).toBe(0);
  });

  it("counts whole calendar days late", () => {
    expect(daysOverdue(item({ id: "f", due_date: daysFromToday(-31) }))).toBe(31);
    expect(daysOverdue(item({ id: "g", due_date: daysFromToday(5) }))).toBe(0);
  });
});

describe("bucketCounts", () => {
  it("reports every bucket, including empty ones", () => {
    const counts = bucketCounts([
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c", state: "approved", decided_at: "2026-08-20T09:00:00Z" }),
    ]);
    expect(counts).toEqual({ "your-move": 2, "with-us": 0, "signed-off": 1 });
  });
});

describe("sortForQueue", () => {
  it("puts undecided first, oldest due first, undated last", () => {
    const order = sortForQueue([
      item({ id: "done", state: "approved", decided_at: "2026-08-20T09:00:00Z" }),
      item({ id: "undated" }),
      item({ id: "soon", due_date: daysFromToday(2) }),
      item({ id: "ancient", due_date: daysFromToday(-31) }),
    ]).map((i) => i.id);

    expect(order).toEqual(["ancient", "soon", "undated", "done"]);
  });

  it("orders decided items most-recent first", () => {
    const order = sortForQueue([
      item({ id: "older", state: "approved", decided_at: "2026-08-01T09:00:00Z" }),
      item({ id: "newer", state: "approved", decided_at: "2026-08-20T09:00:00Z" }),
    ]).map((i) => i.id);

    expect(order).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const input = [item({ id: "b", due_date: daysFromToday(1) }), item({ id: "a", due_date: daysFromToday(-1) })];
    const before = input.map((i) => i.id);
    sortForQueue(input);
    expect(input.map((i) => i.id)).toEqual(before);
  });
});

describe("formatAsAt", () => {
  it("renders local hours and minutes, zero-padded", () => {
    expect(formatAsAt(new Date(2026, 7, 24, 8, 31).toISOString())).toBe("08:31");
  });

  it("renders nothing rather than 'Invalid Date'", () => {
    expect(formatAsAt("not a timestamp")).toBe("");
  });
});
