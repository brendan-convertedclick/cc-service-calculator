import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  formatEventTime,
  type ActivityRow,
  type TimelineSource,
} from "@/lib/client-timeline";

function source(over: Partial<TimelineSource> = {}): TimelineSource {
  return {
    created_at: "2026-08-01T08:00:00Z",
    state: "pending",
    item_type: "brief",
    decided_at: null,
    decided_by_name: null,
    client_note: null,
    emailed_at: null,
    emailed_to: null,
    email_failed: null,
    opens: [],
    ...over,
  };
}

function row(over: Partial<ActivityRow> & { id: string }): ActivityRow {
  return {
    kind: "message",
    body: "Any news on this?",
    created_at: "2026-08-05T09:00:00Z",
    outbound_email_id: null,
    author_name: "Lisa",
    from_state: null,
    to_state: null,
    ...over,
  };
}

describe("buildTimeline", () => {
  it("always opens with the ask, phrased for the item type", () => {
    expect(buildTimeline(source(), [])[0].summary).toBe("Sent for sign-off");
    expect(buildTimeline(source({ item_type: "question" }), [])[0].summary).toBe("Question raised");
    expect(buildTimeline(source({ item_type: "agreement" }), [])[0].summary).toBe(
      "Recorded as something they agreed to",
    );
  });

  it("runs oldest first — it is read as a story, not a feed", () => {
    const events = buildTimeline(
      source({
        emailed_at: "2026-08-01T08:05:00Z",
        emailed_to: ["asavela@omc.com"],
        opens: [{ name: "Asavela Ludidi", at: "2026-08-03T10:00:00Z" }],
        decided_at: "2026-08-09T11:00:00Z",
        decided_by_name: "Asavela Ludidi",
        state: "approved",
      }),
      [row({ id: "m1" })],
    );
    expect(events.map((e) => e.kind)).toEqual([
      "asked",
      "emailed",
      "opened",
      "message",
      "decided",
    ]);
  });

  it("says the email failed rather than silently showing nothing", () => {
    const events = buildTimeline(source({ email_failed: "Gmail 400: bad address" }), []);
    expect(events[1].summary).toBe("Email did not go out");
    expect(events[1].body).toContain("Gmail 400");
  });

  it("names who opened, because the link belongs to one person", () => {
    const events = buildTimeline(
      source({ opens: [{ name: "Asavela Ludidi", at: "2026-08-03T10:00:00Z" }] }),
      [],
    );
    expect(events[1].summary).toBe("Asavela Ludidi last opened their sign-off page");
  });

  it("keeps notes and messages apart — a chase and a thought must not look alike", () => {
    const events = buildTimeline(source(), [
      row({ id: "m1", kind: "message" }),
      row({ id: "n1", kind: "note", body: "Spoke to her at the open day.", created_at: "2026-08-06T09:00:00Z" }),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["asked", "message", "note"]);
  });

  it("uses the right verb for each kind of decision", () => {
    const decided = (item_type: string, state: string) =>
      buildTimeline(
        source({
          item_type,
          state,
          decided_at: "2026-08-09T11:00:00Z",
          decided_by_name: "Asavela",
        }),
        [],
      ).at(-1)!.summary;

    expect(decided("brief", "approved")).toBe("Asavela approved it");
    expect(decided("question", "approved")).toBe("Asavela answered");
    expect(decided("agreement", "approved")).toBe("Asavela marked it done");
    expect(decided("brief", "changes_requested")).toBe("Asavela sent it back");
  });

  it("does not invent a decision on a pending item", () => {
    expect(buildTimeline(source(), []).some((e) => e.kind === "decided")).toBe(false);
  });
});

describe("formatEventTime", () => {
  it("returns an empty string rather than 'Invalid Date'", () => {
    expect(formatEventTime("not a date")).toBe("");
  });

  it("renders a real timestamp", () => {
    expect(formatEventTime("2026-08-31T11:45:00Z")).toMatch(/31 Aug at \d\d:\d\d/);
  });
});

describe("buildTimeline — the client's half", () => {
  it("names who replied, and does not repeat them as the actor", () => {
    const events = buildTimeline(source(), [
      row({
        id: "r1",
        kind: "client_message",
        body: "Logos are with marketing — Friday?",
        author_name: "Asavela Ludidi",
      }),
    ]);
    const reply = events.at(-1)!;
    expect(reply.kind).toBe("replied");
    expect(reply.summary).toBe("Asavela Ludidi replied");
    expect(reply.actor).toBeNull();
    expect(reply.body).toContain("marketing");
  });

  it("falls back to 'They replied' on a shared link with no name", () => {
    const events = buildTimeline(source(), [
      row({ id: "r1", kind: "client_message", author_name: null }),
    ]);
    expect(events.at(-1)!.summary).toBe("They replied");
  });

  it("keeps our chase and their reply visually distinct kinds", () => {
    const events = buildTimeline(source(), [
      row({ id: "m1", kind: "message", created_at: "2026-08-05T09:00:00Z" }),
      row({ id: "r1", kind: "client_message", created_at: "2026-08-05T10:00:00Z" }),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["asked", "message", "replied"]);
  });
});

describe("buildTimeline — status changes", () => {
  it("names who moved it and where to", () => {
    const events = buildTimeline(source(), [
      row({
        id: "s1",
        kind: "status",
        body: null,
        from_state: "pending",
        to_state: "approved",
        author_name: "Brendan Gunn",
      }),
    ]);
    const s = events.at(-1)!;
    expect(s.kind).toBe("status");
    expect(s.summary).toBe("Brendan Gunn moved this to signed off");
  });

  it("says reopened when it comes back from a settled state", () => {
    const events = buildTimeline(source(), [
      row({
        id: "s1",
        kind: "status",
        body: null,
        from_state: "approved",
        to_state: "pending",
        author_name: "Brendan Gunn",
      }),
    ]);
    expect(events.at(-1)!.summary).toBe(
      "Brendan Gunn reopened this — back to waiting on the client",
    );
  });

  it("carries the reason when someone gave one", () => {
    const events = buildTimeline(source(), [
      row({
        id: "s1",
        kind: "status",
        body: "She confirmed on the call.",
        from_state: "pending",
        to_state: "approved",
        author_name: "Brendan",
      }),
    ]);
    expect(events.at(-1)!.body).toBe("She confirmed on the call.");
  });

  it("does not read like a message or a reply", () => {
    const events = buildTimeline(source(), [
      row({ id: "m1", kind: "message" }),
      row({ id: "s1", kind: "status", body: null, from_state: "pending", to_state: "approved", created_at: "2026-08-06T09:00:00Z" }),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["asked", "message", "status"]);
  });
});
