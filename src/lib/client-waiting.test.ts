import { describe, expect, it } from "vitest";
import { clientShare, courtOf, formatWait, waitSplit, type WaitingSource } from "@/lib/client-waiting";

const NOW = Date.parse("2026-08-30T12:00:00Z");
const HOUR = 3_600_000;

function row(over: Partial<WaitingSource> = {}): WaitingSource {
  return {
    clickup_task_status: "in progress",
    clickup_status_synced_at: new Date(NOW - 2 * HOUR).toISOString(),
    client_wait_ms: 0,
    internal_wait_ms: 0,
    completed_at: null,
    ...over,
  };
}

describe("courtOf", () => {
  it("puts a waiting-on-client task in the client's court", () => {
    expect(courtOf(row({ clickup_task_status: "waiting on client" }))).toBe("client");
    expect(courtOf(row({ clickup_task_status: "send to client" }))).toBe("client");
  });

  it("puts everything else open in ours", () => {
    expect(courtOf(row({ clickup_task_status: "planned" }))).toBe("us");
    expect(courtOf(row({ clickup_task_status: null }))).toBe("us");
  });

  it("is nobody's move once it is closed", () => {
    expect(courtOf(row({ clickup_task_status: "Closed" }))).toBe("done");
    // completed_at wins even if the status has not synced yet
    expect(courtOf(row({ completed_at: "2026-08-29T09:00:00Z" }))).toBe("done");
  });
});

describe("waitSplit", () => {
  it("adds the running clock to whoever holds the task", () => {
    const s = waitSplit(
      row({ clickup_task_status: "waiting on client", client_wait_ms: 5 * HOUR, internal_wait_ms: HOUR }),
      NOW,
    );
    expect(s.court).toBe("client");
    expect(s.clientMs).toBe(7 * HOUR); // 5 banked + 2 since the sync
    expect(s.internalMs).toBe(HOUR); // untouched
  });

  it("adds it to our side when the ball is with us", () => {
    const s = waitSplit(row({ internal_wait_ms: 3 * HOUR, client_wait_ms: 4 * HOUR }), NOW);
    expect(s.internalMs).toBe(5 * HOUR);
    expect(s.clientMs).toBe(4 * HOUR);
  });

  it("stops both clocks on a closed task — history, not a running total", () => {
    const s = waitSplit(
      row({ clickup_task_status: "closed", client_wait_ms: 9 * HOUR, internal_wait_ms: 2 * HOUR }),
      NOW,
    );
    expect(s).toEqual({ court: "done", clientMs: 9 * HOUR, internalMs: 2 * HOUR });
  });

  it("never subtracts time when the sync stamp is in the future", () => {
    const s = waitSplit(
      row({
        clickup_task_status: "waiting on client",
        clickup_status_synced_at: new Date(NOW + 5 * HOUR).toISOString(),
        client_wait_ms: 3 * HOUR,
      }),
      NOW,
    );
    expect(s.clientMs).toBe(3 * HOUR);
  });

  it("survives a never-synced row", () => {
    const s = waitSplit(
      row({ clickup_status_synced_at: null, client_wait_ms: null, internal_wait_ms: null }),
      NOW,
    );
    expect(s).toEqual({ court: "us", clientMs: 0, internalMs: 0 });
  });
});

describe("formatWait", () => {
  it("reads in the units a human argues in", () => {
    expect(formatWait(null)).toBe("—");
    expect(formatWait(0)).toBe("—");
    expect(formatWait(40 * 60_000)).toBe("40m");
    expect(formatWait(5 * HOUR)).toBe("5h");
    expect(formatWait(48 * HOUR)).toBe("2d");
    expect(formatWait(52 * HOUR)).toBe("2d 4h");
  });
});

describe("clientShare", () => {
  it("is null when nothing has been waited", () => {
    expect(clientShare({ court: "us", clientMs: 0, internalMs: 0 })).toBeNull();
  });

  it("is the client's fraction of the total", () => {
    expect(clientShare({ court: "client", clientMs: 3, internalMs: 1 })).toBe(0.75);
  });
});
