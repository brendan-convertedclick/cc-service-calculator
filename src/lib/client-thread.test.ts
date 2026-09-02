import { describe, expect, it } from "vitest";
import { threadOf } from "@/lib/client-review";
import type { ReviewItem } from "@/types/client-review";

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "i1",
    item_type: "question",
    client_title: "Open Day mailer copy",
    ask: "Which of the two headlines?",
    detail: null,
    due_date: null,
    weighty: false,
    state: "pending",
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

describe("threadOf", () => {
  it("opens with the ask, from us, dated when we asked", () => {
    const [first] = threadOf(item());
    expect(first.from).toBe("us");
    expect(first.body).toBe("Which of the two headlines?");
    expect(first.at).toBe("2026-08-01T08:00:00Z");
  });

  it("keeps everything said since, in order, after it", () => {
    const thread = threadOf(
      item({
        messages: [
          { id: "m1", from: "us", author: null, body: "Any news?", at: "2026-08-05T09:00:00Z" },
          { id: "r1", from: "them", author: "Asavela", body: "Friday", at: "2026-08-05T10:00:00Z" },
        ],
      }),
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Which of the two headlines?",
      "Any news?",
      "Friday",
    ]);
  });

  it("gives the ask a key that cannot collide with a real message id", () => {
    const thread = threadOf(item({ messages: [{ id: "i1", from: "us", author: null, body: "x", at: "2026-08-05T09:00:00Z" }] }));
    expect(new Set(thread.map((m) => m.id)).size).toBe(2);
  });
});

describe("threadOf — the decision", () => {
  it("puts their answer in the thread as their own bubble, not in a banner", () => {
    const thread = threadOf(
      item({
        state: "approved",
        client_note: "The second headline please.",
        decided_at: "2026-08-09T11:00:00Z",
        decided_by_name: "Asavela Ludidi",
      }),
    );
    const last = thread.at(-1)!;
    expect(last.from).toBe("them");
    expect(last.author).toBe("Asavela Ludidi");
    expect(last.body).toBe("The second headline please.");
    expect(last.at).toBe("2026-08-09T11:00:00Z");
  });

  it("keeps a message sent AFTER the decision below it", () => {
    const thread = threadOf(
      item({
        state: "approved",
        client_note: "Approved.",
        decided_at: "2026-08-09T11:00:00Z",
        decided_by_name: "Asavela",
        messages: [
          { id: "m2", from: "us", author: null, body: "Thanks!", at: "2026-08-09T12:00:00Z" },
        ],
      }),
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Which of the two headlines?",
      "Approved.",
      "Thanks!",
    ]);
  });

  it("adds nothing when a decision carried no words", () => {
    const thread = threadOf(
      item({ state: "approved", client_note: null, decided_at: "2026-08-09T11:00:00Z" }),
    );
    expect(thread).toHaveLength(1);
  });

  it("ignores a note with no decision timestamp — that pairing cannot be placed", () => {
    expect(threadOf(item({ client_note: "stray", decided_at: null }))).toHaveLength(1);
  });
});

describe("threadOf, when the client started it", () => {
  it("opens with THEIR bubble, in their name", () => {
    // A question they asked, rendered as ours, would show a client their own
    // words attributed to Converted Click on the one page whose entire job is
    // to be trustworthy about who said what.
    const thread = threadOf(
      item({
        raised_by: "client",
        raised_by_name: "Chantal Jacobs",
        ask: "Are we still on for the October send?",
        owed_by: "us",
      }),
    );
    expect(thread[0]).toMatchObject({
      from: "them",
      author: "Chantal Jacobs",
      body: "Are we still on for the October send?",
    });
  });

  it("still opens as ours when we asked", () => {
    const thread = threadOf(item({ ask: "Which of the two headlines?" }));
    expect(thread[0]).toMatchObject({ from: "us", author: null });
  });

  it("names nobody on a legacy shared link rather than guessing", () => {
    const thread = threadOf(item({ raised_by: "client", raised_by_name: null }));
    expect(thread[0]).toMatchObject({ from: "them", author: null });
  });
});
