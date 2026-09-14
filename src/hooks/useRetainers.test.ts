import { describe, expect, it } from "vitest";
import { isBillableRetainer, isInternalRetainer } from "./useRetainers";

const retainer = (over: Partial<Parameters<typeof isBillableRetainer>[0]> = {}) => ({
  is_recurring_task: false,
  retainer_monthly_fee_cents: 5348300,
  retainer_hours_target: 46.51,
  ...over,
});

// Which retainers a brief may be billed against. Getting this wrong does not
// throw — it quietly files the work where no budget and no invoice will ever
// see it, which is why it is a predicate with a test rather than a condition
// inline in a dropdown.
describe("isBillableRetainer", () => {
  it("accepts a retainer with a fee behind it", () => {
    expect(isBillableRetainer(retainer())).toBe(true);
  });

  it("accepts an hours target with no fee — the budget is still real", () => {
    expect(isBillableRetainer(retainer({ retainer_monthly_fee_cents: null }))).toBe(true);
  });

  it("rejects the open arrangement — no fee and no target", () => {
    // Trellidor's, which is itself named "Adhoc Retainer" and is therefore the
    // most obvious thing in the list to pick for ad hoc work. bucketOf will not
    // route to it, so a brief pointed here lands in "Retainer work, no
    // retainer": counted against nothing, invoiced on nothing.
    expect(
      isBillableRetainer(
        retainer({ retainer_monthly_fee_cents: null, retainer_hours_target: null }),
      ),
    ).toBe(false);
  });

  it("rejects a standing monthly task even though it carries a fee", () => {
    // 0154: it answers "is this getting done", not "what does this fee buy".
    expect(
      isBillableRetainer(retainer({ is_recurring_task: true, retainer_monthly_fee_cents: 57500 })),
    ).toBe(false);
  });
});

describe("isInternalRetainer", () => {
  it("is true when the client is one of our brands, whatever the retainer says", () => {
    expect(isInternalRetainer({ is_internal: false, client_is_internal: true })).toBe(true);
  });

  it("is true when the one retainer is flagged, on a paying client", () => {
    expect(isInternalRetainer({ is_internal: true, client_is_internal: false })).toBe(true);
  });

  it("is false for ordinary client work", () => {
    expect(isInternalRetainer({ is_internal: false, client_is_internal: false })).toBe(false);
  });

  it("treats a null flag as not set rather than as internal", () => {
    expect(isInternalRetainer({ is_internal: null, client_is_internal: false })).toBe(false);
  });
});
