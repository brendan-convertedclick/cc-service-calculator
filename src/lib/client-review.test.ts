import { describe, it, expect } from "vitest";
import { toISODate } from "./dates";
import {
  agreedLine,
  bucketOf,
  bucketCounts,
  daysOverdue,
  dueStatus,
  eventDateLabel,
  formatAsAt,
  isOverdue,
  sortForQueue,
  typeLabelFor,
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
    item_type: "brief",
    client_title: `Item ${over.id}`,
    ask: "Sign this off",
    detail: null,
    due_date: null,
    weighty: false,
    state: "pending" as ReviewItemState,
    decided_at: null,
    decided_by_name: null,
    agreed_at: null,
    agreed_via: null,
    owed_by: "client",
    raised_by: "us",
    raised_by_name: null,
    waiting_ms: null,
    messages: [],
    created_at: "2026-08-01T08:00:00Z",
    client_note: null,
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
    expect(counts).toEqual({ "your-move": 2, "with-us": 0, "signed-off": 1, "coming-up": 0 });
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

describe("dueStatus", () => {
  it("counts the days on an overdue item — the number the queue is sorted by", () => {
    expect(dueStatus(item({ id: "a", due_date: daysFromToday(-32) }))).toEqual({
      kind: "overdue",
      days: 32,
    });
  });

  it("says today rather than 'due in 0d'", () => {
    expect(dueStatus(item({ id: "a", due_date: daysFromToday(0) }))).toEqual({ kind: "today" });
  });

  it("counts forward on something not yet due", () => {
    expect(dueStatus(item({ id: "a", due_date: daysFromToday(20) }))).toEqual({
      kind: "upcoming",
      days: 20,
    });
  });

  it("is silent when there is no deadline — a blank date is not a deadline of zero", () => {
    expect(dueStatus(item({ id: "a", due_date: null }))).toBeNull();
  });

  it("is silent once decided — how late it was is our record, not a reproach", () => {
    expect(
      dueStatus(item({ id: "a", due_date: daysFromToday(-9), state: "approved" })),
    ).toBeNull();
  });
});

describe("dueStatus — the undated ask", () => {
  it("counts how long it has sat with the client when no date was ever set", () => {
    expect(dueStatus(item({ id: "a", due_date: null, waiting_ms: 3 * 86_400_000 }))).toEqual({
      kind: "waiting",
      days: 3,
    });
  });

  it("stays silent for the first day — 'Waiting 0d' says nothing", () => {
    expect(dueStatus(item({ id: "a", due_date: null, waiting_ms: 3_600_000 }))).toBeNull();
    expect(dueStatus(item({ id: "a", due_date: null, waiting_ms: null }))).toBeNull();
  });

  it("prefers the real date when there is one, ignoring the clock", () => {
    expect(
      dueStatus(item({ id: "a", due_date: daysFromToday(-32), waiting_ms: 3 * 86_400_000 })),
    ).toEqual({ kind: "overdue", days: 32 });
  });
});

describe("sortForQueue — pressure, not raw due date", () => {
  it("ranks a long-untouched undated ask above a barely-late dated one", () => {
    const order = sortForQueue([
      item({ id: "late-2d", due_date: daysFromToday(-2) }),
      item({ id: "sat-30d", due_date: null, waiting_ms: 30 * 86_400_000 }),
      item({ id: "due-soon", due_date: daysFromToday(5) }),
    ]).map((i) => i.id);
    expect(order).toEqual(["sat-30d", "late-2d", "due-soon"]);
  });

  it("still puts everything undecided ahead of anything decided", () => {
    const order = sortForQueue([
      item({ id: "done", state: "approved", decided_at: new Date().toISOString() }),
      item({ id: "fresh", due_date: null }),
    ]).map((i) => i.id);
    expect(order).toEqual(["fresh", "done"]);
  });
});

describe("an agreement we made", () => {
  const ours = (over = {}) =>
    item({ id: "ours", item_type: "agreement", owed_by: "us", ...over });

  it("sits under 'With us', never in their move pile", () => {
    expect(bucketOf(ours())).toBe("with-us");
    // theirs still behaves as before
    expect(bucketOf(item({ id: "theirs", item_type: "agreement" }))).toBe("your-move");
  });

  it("is never shown to the client as overdue — ours to fix, not to nag them with", () => {
    expect(isOverdue(ours({ due_date: daysFromToday(-9) }))).toBe(false);
    expect(dueStatus(ours({ due_date: daysFromToday(-9) }))).toBeNull();
  });

  it("still reads as done once closed", () => {
    expect(bucketOf(ours({ state: "approved", decided_at: new Date().toISOString() }))).toBe(
      "signed-off",
    );
  });

  it("labels the promise by who made it", () => {
    expect(typeLabelFor(ours())).toBe("We agreed");
    expect(typeLabelFor(item({ id: "t", item_type: "agreement" }))).toBe("You agreed");
    expect(typeLabelFor(item({ id: "b" }))).toBe("Sign-off");
  });

  it("says so in the agreed line", () => {
    expect(agreedLine(ours({ agreed_at: "2026-08-04", agreed_via: "meeting" }))).toBe(
      "We agreed on 4 August, in a meeting.",
    );
  });
});

describe("events", () => {
  const event = (id: string, date: string) =>
    item({ id, item_type: "event", state: "noted", due_date: date, owed_by: "client" });

  it("sits in its own bucket, in nobody's court", () => {
    expect(bucketOf(event("e1", daysFromToday(10)))).toBe("coming-up");
  });

  it("is never overdue and never due — its date is not a deadline", () => {
    // Its date passing is not lateness. Without the separate state this would
    // read as an overdue ask the day after a client's launch.
    const past = event("e1", daysFromToday(-30));
    expect(isOverdue(past)).toBe(false);
    expect(dueStatus(past)).toBeNull();
    expect(daysOverdue(past)).toBe(0);
  });

  it("reads as a diary — soonest first, not by title", () => {
    const order = sortForQueue([
      event("z", daysFromToday(20)),
      event("a", daysFromToday(2)),
      event("m", daysFromToday(9)),
    ]).map((i) => i.id);
    expect(order).toEqual(["a", "m", "z"]);
  });

  it("labels its date, and labels nothing else", () => {
    expect(eventDateLabel(event("e1", "2026-09-14"))).toMatch(/14 Sep/);
    expect(eventDateLabel(item({ id: "b1", due_date: "2026-09-14" }))).toBeNull();
  });

  it("counts in its own bucket and leaves the other three alone", () => {
    const counts = bucketCounts([
      item({ id: "p1" }),
      event("e1", daysFromToday(3)),
      event("e2", daysFromToday(4)),
    ]);
    expect(counts).toMatchObject({ "your-move": 1, "coming-up": 2, "with-us": 0 });
  });
});

describe("a question the client asked us", () => {
  it("reads as theirs on the chip", () => {
    const theirs = item({ id: "q1", item_type: "question", owed_by: "us", raised_by: "client" });
    expect(typeLabelFor(theirs)).toBe("You asked");
    // Ours still reads as a question we are asking them.
    expect(typeLabelFor(item({ id: "q2", item_type: "question" }))).toBe("Question");
  });

  it("sits with us, because a question you asked is not one you answer", () => {
    expect(
      bucketOf(item({ id: "q1", item_type: "question", owed_by: "us", raised_by: "client" })),
    ).toBe("with-us");
  });
});
