import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { periodRange, computeMultiplier } from "./output-multiplier-logic.ts";

Deno.test("periodRange month: returns correct start, end and label", () => {
  const r = periodRange("month", "2026-05-12");
  assertEquals(r.startDate, "2026-05-01");
  assertEquals(r.endDate, "2026-06-01");
  assertEquals(r.label, "May 2026");
});

Deno.test("periodRange week: returns Mon-to-Mon range and W-label", () => {
  // 2026-05-12 is a Tuesday
  const r = periodRange("week", "2026-05-12");
  assertEquals(r.startDate, "2026-05-11"); // Monday
  assertEquals(r.endDate, "2026-05-18");   // following Monday (exclusive)
  assertMatch(r.label, /W\d+ 2026/);
});

Deno.test("periodRange year: returns full calendar year", () => {
  const r = periodRange("year", "2026-05-12");
  assertEquals(r.startDate, "2026-01-01");
  assertEquals(r.endDate, "2027-01-01");
  assertEquals(r.label, "2026");
});

Deno.test("computeMultiplier: (human + ai) / human", () => {
  assertEquals(computeMultiplier(2, 18), 10);
});

Deno.test("computeMultiplier: caps at 20", () => {
  assertEquals(computeMultiplier(0.1, 100), 20);
});

Deno.test("computeMultiplier: returns 1 when human hours is 0", () => {
  assertEquals(computeMultiplier(0, 10), 1);
});

Deno.test("computeMultiplier: returns 1 when no AI hours", () => {
  assertEquals(computeMultiplier(5, 0), 1);
});
