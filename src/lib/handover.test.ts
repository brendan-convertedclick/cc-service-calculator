// The hand-over gate (0204) lives in supabase/functions/_shared/handover.ts so
// the edge function and this test read one copy. It is pure TS, no Deno.
import { describe, expect, it } from "vitest";
import {
  bounceComment,
  bounceStatus,
  closingComment,
  CONDUCTOR_MARK,
  gate,
  isInternalLink,
  linksIn,
  MAX_PROOF_FILES,
  storageName,
} from "../../supabase/functions/_shared/handover";

const comment = (id: string, text: string, date: number, username = "Sithembile Tshabalala") => ({
  id,
  comment_text: text,
  date: String(date),
  user: { id: 1, username },
});
const file = (id: string, date: number, size = 1000) => ({
  id,
  title: `${id}.png`,
  url: `https://t.clickup-attachments.com/${id}.png`,
  mimetype: "image/png",
  size,
  date: String(date),
});
const DONE = "Hero banner replaced and live on the homepage, mobile checked too.";

describe("closingComment", () => {
  it("takes the newest human comment after the cut-off", () => {
    const c = closingComment([comment("a", "old words here", 100), comment("b", DONE, 300), comment("c", "earlier", 200)], 0);
    expect(c?.id).toBe("b");
    expect(c?.author).toBe("Sithembile Tshabalala");
  });

  it("never treats Conductor's own comments as the doer's", () => {
    const c = closingComment([comment("a", DONE, 100), comment("b", `${CONDUCTOR_MARK}: not sent yet`, 300)], 0);
    expect(c?.id).toBe("a");
  });

  it("ignores everything from before the last client decision", () => {
    expect(closingComment([comment("a", DONE, 100)], 200)).toBeNull();
  });
});

describe("gate", () => {
  it("passes with a closing comment and a file", () => {
    const r = gate([comment("a", DONE, 100)], [file("f1", 90)], 0);
    expect(r.ok).toBe(true);
  });

  it("passes with a closing comment that carries a client-openable link", () => {
    const r = gate([comment("a", `${DONE} https://school.co.za/open-day.`, 100)], [], 0);
    expect(r).toMatchObject({ ok: true, links: ["https://school.co.za/open-day"] });
  });

  it("does not count a ClickUp link as proof — the client cannot open it", () => {
    const r = gate([comment("a", `${DONE} https://app.clickup.com/t/abc`, 100)], [], 0);
    expect(r).toMatchObject({ ok: false, missing: ["proof"] });
  });

  it("bounces a one-word comment", () => {
    const r = gate([comment("a", "done", 100)], [file("f1", 90)], 0);
    expect(r).toMatchObject({ ok: false, missing: ["comment"] });
  });

  it("bounces when nothing was written or attached", () => {
    expect(gate([], [], 0)).toMatchObject({ ok: false, missing: ["comment", "proof"] });
  });

  it("only keeps files from the current round, newest first, capped", () => {
    const files = Array.from({ length: 14 }, (_, i) => file(`f${i}`, 100 + i));
    const r = gate([comment("a", DONE, 500)], [file("old", 50), ...files], 60);
    expect(r.ok && r.files.length).toBe(MAX_PROOF_FILES);
    expect(r.ok && r.files[0].id).toBe("f13");
    expect(r.ok && r.files.some((f) => f.id === "old")).toBe(false);
  });

  it("skips files over the size cap", () => {
    const r = gate([comment("a", DONE, 100)], [file("huge", 90, 50 * 1024 * 1024)], 0);
    expect(r).toMatchObject({ ok: false, missing: ["proof"] });
  });
});

describe("links", () => {
  it("drops credentials, other schemes and duplicates", () => {
    expect(linksIn("see https://a.co/x, https://a.co/x and ftp://b.co and https://u:p@c.co")).toEqual(["https://a.co/x"]);
  });
  it("calls ClickUp hosts internal", () => {
    expect(isInternalLink("https://app.clickup.com/t/1")).toBe(true);
    expect(isInternalLink("https://example.com")).toBe(false);
  });
});

describe("bounce", () => {
  it("prefers an in-progress status and never a closed one", () => {
    expect(
      bounceStatus([
        { status: "to do", type: "open", orderindex: 0 },
        { status: "in progress", type: "custom", orderindex: 1 },
        { status: "send to client", type: "custom", orderindex: 2 },
        { status: "complete", type: "closed", orderindex: 3 },
      ]),
    ).toBe("in progress");
    expect(bounceStatus([{ status: "backlog", type: "open" }, { status: "complete", type: "closed" }])).toBe("backlog");
  });
  it("says what is missing, in the doer's terms", () => {
    expect(bounceComment(["proof"])).toMatch(/attach the file/);
    expect(bounceComment(["proof"])).not.toMatch(/closing comment \(/);
  });
});

describe("storageName", () => {
  it("keeps the extension and strips path characters", () => {
    expect(storageName("../Hero banner (final).png", 0)).toBe("01-Hero-banner-final.png");
  });
});
