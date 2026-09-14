import { describe, expect, it } from "vitest";
import { billingKey, impliedRateCents, type ClientMonthBilling } from "./useAdhocInvoices";

const billing = (over: Partial<ClientMonthBilling> = {}): ClientMonthBilling => ({
  invoicedNetCents: 0,
  quotedNetCents: 0,
  docs: [],
  ...over,
});

describe("impliedRateCents", () => {
  // The live case this was built for: Pimms' September ad hoc is 2.4h against
  // INV-2599 at R1,625 net — about R677 an hour on a book priced at R1,150.
  it("divides what was charged by the hours it took", () => {
    expect(impliedRateCents(billing({ invoicedNetCents: 162_500 }), 2.4)).toBe(67_708);
  });

  // An accepted quote is money committed against work already being done, so
  // leaving it out would make a quoted job read as unbilled.
  it("counts an accepted quote alongside invoices", () => {
    const b = billing({ invoicedNetCents: 100_000, quotedNetCents: 550_000 });
    expect(impliedRateCents(b, 10)).toBe(65_000);
  });

  it("is null with no hours — a rate needs something to divide", () => {
    expect(impliedRateCents(billing({ invoicedNetCents: 162_500 }), 0)).toBeNull();
  });

  it("is null with nothing charged, rather than reporting R0 an hour", () => {
    expect(impliedRateCents(billing(), 5)).toBeNull();
    expect(impliedRateCents(undefined, 5)).toBeNull();
  });
});

describe("billingKey", () => {
  it("keys on client and month, not client name", () => {
    expect(billingKey("abc", "2026-09")).toBe("abc|2026-09");
  });
});
