import { describe, expect, it } from "vitest";
import { hoursOf } from "./useRetainerAllocation";

// The one rule Completed is built on (0160): an item is worth its logged time
// when someone logged it and its estimate when nobody did. Everything else in
// the hook is bookkeeping on top of this, so this is the thing that has to
// stay true.
describe("hoursOf", () => {
  it("prefers logged time over the estimate", () => {
    // Pimms' August ad hoc: 3.0h estimated, 4.9h actually spent. Reporting the
    // estimate when the real figure is in the next column is a choice to be
    // wrong — and it is wrong in our favour, which is worse.
    expect(hoursOf(4.9, 3.0)).toEqual({ hours: 4.9, measured: true });
  });

  it("falls back to the estimate when nothing was logged", () => {
    expect(hoursOf(null, 2.5)).toEqual({ hours: 2.5, measured: false });
    expect(hoursOf(undefined, 2.5)).toEqual({ hours: 2.5, measured: false });
  });

  it("treats a logged zero as nobody logged it, not as no time taken", () => {
    // ClickUp writes 0 for a task whose timer was never touched. Taking that
    // literally would report a month of finished work as having cost nothing.
    expect(hoursOf(0, 1.25)).toEqual({ hours: 1.25, measured: false });
  });

  it("reports nothing when there is neither a log nor an estimate", () => {
    expect(hoursOf(null, 0)).toEqual({ hours: 0, measured: false });
  });
});
