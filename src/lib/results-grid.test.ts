import { describe, expect, it } from "vitest";
import {
  cellState,
  compareLine,
  formatValue,
  hasValue,
  isPast,
  laneShade,
  planHeadline,
  resultsOpen,
  starredFields,
  type ResultsTemplate,
  type ResultsTemplateField,
} from "@/lib/results-grid";

const NBSP = "\u00a0";
const NOW = { year: 2026, month: 9 };

function field(overrides: Partial<ResultsTemplateField> & { id: string }): ResultsTemplateField {
  return {
    label: overrides.id,
    short_label: null,
    type: "number",
    phase: "result",
    star: false,
    target_field_id: null,
    ordinal: 0,
    retired_at: null,
    ...overrides,
  };
}

const PAID: ResultsTemplate = {
  id: "tpl-paid",
  name: "Paid channel",
  fields: [
    field({ id: "what", type: "text", phase: "plan", ordinal: 0 }),
    field({ id: "budget", type: "money", phase: "plan", ordinal: 1 }),
    field({ id: "tleads", label: "Target leads", type: "number", phase: "plan", ordinal: 2 }),
    field({ id: "spend", type: "money", phase: "result", star: true, ordinal: 3 }),
    field({ id: "leads", label: "Leads", type: "number", phase: "result", star: true, target_field_id: "tleads", ordinal: 4 }),
    field({ id: "clicks", type: "number", phase: "result", ordinal: 5 }),
    field({ id: "note", type: "text", phase: "result", ordinal: 6 }),
  ],
};

describe("resultsOpen", () => {
  it("is open for the current month and any past month", () => {
    expect(resultsOpen(2026, 9, NOW)).toBe(true);
    expect(resultsOpen(2026, 1, NOW)).toBe(true);
    expect(resultsOpen(2025, 12, NOW)).toBe(true);
  });
  it("is closed for a future month", () => {
    expect(resultsOpen(2026, 10, NOW)).toBe(false);
    expect(resultsOpen(2027, 1, NOW)).toBe(false);
  });
});

describe("cellState", () => {
  it("empty with no entry", () => {
    expect(cellState(2026, 9, PAID, undefined, NOW)).toBe("empty");
  });
  it("plan for a future month with an entry but no results", () => {
    expect(cellState(2026, 10, PAID, { what: "Video" }, NOW)).toBe("plan");
  });
  it("due when the month is over and no result field has a value", () => {
    expect(cellState(2026, 7, PAID, { what: "Video", budget: 5000 }, NOW)).toBe("due");
  });
  it("plan (not due) for the current month itself — results open, not overdue", () => {
    expect(cellState(2026, 9, PAID, { what: "Video" }, NOW)).toBe("plan");
  });
  it("done as soon as any result field has a value, even mid-month", () => {
    expect(cellState(2026, 9, PAID, { what: "Video", spend: 100 }, NOW)).toBe("done");
  });
});

describe("formatValue", () => {
  it("formats money as whole rands via formatZar (cents in)", () => {
    expect(formatValue({ type: "money" }, 450000)).toBe(`R${NBSP}4${NBSP}500`);
  });
  it("formats number with en-ZA thousands separators", () => {
    expect(formatValue({ type: "number" }, 12345)).toBe(`12${NBSP}345`);
  });
  it("formats percent with a trailing %", () => {
    expect(formatValue({ type: "percent" }, 3.8)).toBe("3.8%");
  });
  it("formats a date from its YYYY-MM-DD parts, never shifting across a timezone boundary", () => {
    // Regression: new Date("2026-03-07").toISOString() style parsing would
    // read this as UTC midnight and can render as the day before in SAST.
    expect(formatValue({ type: "date" }, "2026-03-07")).toBe("Sat, 07 Mar");
  });
  it("blank/null/undefined all format to empty string", () => {
    expect(formatValue({ type: "number" }, null)).toBe("");
    expect(formatValue({ type: "number" }, undefined)).toBe("");
    expect(formatValue({ type: "text" }, "")).toBe("");
  });
  it("text passes through as-is", () => {
    expect(formatValue({ type: "text" }, "Start 5 weeks out")).toBe("Start 5 weeks out");
  });
});

describe("starredFields", () => {
  it("returns live result-phase starred fields in ordinal order", () => {
    const stars = starredFields(PAID);
    expect(stars.map((f) => f.id)).toEqual(["spend", "leads"]);
  });
  it("excludes retired fields even if starred", () => {
    const tpl: ResultsTemplate = {
      ...PAID,
      fields: PAID.fields.map((f) => (f.id === "spend" ? { ...f, retired_at: "2026-01-01" } : f)),
    };
    expect(starredFields(tpl).map((f) => f.id)).toEqual(["leads"]);
  });
  it("caps at two even if more are (incorrectly) marked star", () => {
    const tpl: ResultsTemplate = {
      ...PAID,
      fields: PAID.fields.map((f) => (f.id === "clicks" ? { ...f, star: true } : f)),
    };
    expect(starredFields(tpl)).toHaveLength(2);
  });
});

describe("planHeadline", () => {
  it("formats the first live plan field that has a value", () => {
    expect(planHeadline(PAID, { budget: 500000 })).toBe(`R${NBSP}5${NBSP}000`);
  });
  it("skips a blank first field and uses the next one with a value", () => {
    expect(planHeadline(PAID, { what: "", tleads: 20 })).toBe("20");
  });
  it("is empty when no plan field has a value", () => {
    expect(planHeadline(PAID, {})).toBe("");
  });
});

describe("compareLine", () => {
  const leads = PAID.fields.find((f) => f.id === "leads")!;

  it("includes a met target when both the value and target are present", () => {
    const line = compareLine(leads, { leads: 44, tleads: 40 }, { tleads: 40 }, {});
    expect(line?.target).toEqual({ value: "40", met: true });
  });
  it("reports an unmet target", () => {
    const line = compareLine(leads, { leads: 30, tleads: 40 }, { tleads: 40 }, {});
    expect(line?.target?.met).toBe(false);
  });
  it("computes a rounded percentage delta against last year", () => {
    const line = compareLine(leads, { leads: 44 }, {}, { leads: 40 });
    expect(line?.lastYear).toEqual({ value: "40", deltaPct: 10 });
  });
  it("omits deltaPct when last year was zero — a zero denominator is meaningless", () => {
    const line = compareLine(leads, { leads: 44 }, {}, { leads: 0 });
    expect(line?.lastYear?.deltaPct).toBeUndefined();
  });
  it("omits lastYear entirely when last year is blank", () => {
    const line = compareLine(leads, { leads: 44 }, {}, {});
    expect(line?.lastYear).toBeUndefined();
  });
  it("returns null when neither this year nor last year has a value", () => {
    expect(compareLine(leads, {}, {}, {})).toBeNull();
  });
});

describe("laneShade", () => {
  it("shades 1/2/3 band back and clamps 3+ years back to the darkest band", () => {
    expect(laneShade(2026, 2025)).toBe(1);
    expect(laneShade(2026, 2024)).toBe(2);
    expect(laneShade(2026, 2023)).toBe(3);
    expect(laneShade(2026, 2020)).toBe(3);
  });
});

describe("hasValue", () => {
  it("is false for undefined, null and empty string", () => {
    expect(hasValue(undefined)).toBe(false);
    expect(hasValue(null)).toBe(false);
    expect(hasValue("")).toBe(false);
  });
  it("is true for 0, a non-empty string and a number", () => {
    expect(hasValue(0)).toBe(true);
    expect(hasValue("0")).toBe(true);
    expect(hasValue(44)).toBe(true);
  });
});

describe("isPast", () => {
  it("is false for the current month and any future month", () => {
    expect(isPast(2026, 9, NOW)).toBe(false);
    expect(isPast(2026, 10, NOW)).toBe(false);
    expect(isPast(2027, 1, NOW)).toBe(false);
  });
  it("is true for any earlier month, including a prior year", () => {
    expect(isPast(2026, 8, NOW)).toBe(true);
    expect(isPast(2025, 12, NOW)).toBe(true);
  });
});
