// conductor-mcp's pure helpers live in supabase/functions/_shared so the edge
// function and this test read one copy.
import { describe, expect, it } from "vitest";
import {
  emailOf,
  hostMatches,
  normalizeHost,
  retainerMonth,
  ticketStage,
} from "../../supabase/functions/_shared/conductor-context";

describe("sender matching", () => {
  it("reduces emails, urls and hosts to one shape", () => {
    expect(normalizeHost("jane@Mail.Acme.co.za")).toBe("mail.acme.co.za");
    expect(normalizeHost("https://www.acme.co.za/about")).toBe("acme.co.za");
    expect(normalizeHost(null)).toBe("");
  });
  it("matches subdomains but not lookalikes", () => {
    expect(hostMatches("mail.acme.co.za", "acme.co.za")).toBe(true);
    expect(hostMatches("notacme.co.za", "acme.co.za")).toBe(false);
  });
  it("pulls the address out of a From header", () => {
    expect(emailOf('"Jane Doe" <Jane@Acme.co.za>')).toBe("jane@acme.co.za");
    expect(emailOf("jane@acme.co.za")).toBe("jane@acme.co.za");
  });
});

describe("retainerMonth", () => {
  const nov27 = new Date(2026, 10, 27);
  it("says how much is left in plain words", () => {
    const r = retainerMonth(20, 8, nov27);
    expect(r.burn_pct).toBe(40);
    expect(r.days_left).toBe(3);
    expect(r.headline).toBe("12h of 20h left, 3 days to go.");
  });
  it("warns when nearly used and when over", () => {
    expect(retainerMonth(20, 18, nov27).headline).toMatch(/^Nearly used/);
    expect(retainerMonth(20, 21, nov27).headline).toMatch(/^Over/);
  });
  it("copes with no target", () => {
    const r = retainerMonth(null, 3.04, nov27);
    expect(r.burn_pct).toBeNull();
    expect(r.headline).toMatch(/no hours target/);
  });
});

describe("ticketStage", () => {
  it("lets the sign-off row win over the ClickUp status", () => {
    expect(ticketStage("send to client", null, "parked")).toBe("handed_over");
    expect(ticketStage("complete", "2026-11-01", "pending")).toBe("with_client");
    expect(ticketStage("in progress", null, "changes_requested")).toBe("changes");
  });
  it("falls back to ClickUp when nothing was signed off", () => {
    expect(ticketStage("Complete", null, null)).toBe("done");
    expect(ticketStage("in progress", null, null)).toBe("doing");
  });
});
