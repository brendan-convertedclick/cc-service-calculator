import { describe, it, expect } from "vitest";
import { outcomeFor, countListWork } from "./foundations-preview";

// Kings College as it actually was on 2026-09-10: three groups already mapped
// onto differently-named lists, Meetings mapped to nothing.
const KC = "kc";
const ADMIN_G = "g-admin";
const DELIVERY_G = "g-delivery";
const MEETINGS_G = "g-meetings";
const existing = new Map([
  [`${KC}|${ADMIN_G}`, "Admin"],
  [`${KC}|${DELIVERY_G}`, "Creative"],
]);

describe("outcomeFor", () => {
  it("names the list a baseline will land on for a single client", () => {
    expect(outcomeFor(ADMIN_G, [KC], existing)).toEqual({
      text: "maps to Admin",
      creates: false,
    });
  });

  it("says it will create when the group has no list", () => {
    expect(outcomeFor(MEETINGS_G, [KC], existing)).toEqual({
      text: "will create",
      creates: true,
    });
  });

  it("counts rather than names once more than one client is picked", () => {
    expect(outcomeFor(ADMIN_G, [KC, "tns"], existing)).toEqual({
      text: "1 of 2 mapped",
      creates: true,
    });
    expect(outcomeFor(ADMIN_G, [KC, KC], existing)).toEqual({
      text: "all mapped already",
      creates: false,
    });
  });

  it("shows nothing without a group or a client", () => {
    expect(outcomeFor(null, [KC], existing)).toBeNull();
    expect(outcomeFor(ADMIN_G, [], existing)).toBeNull();
  });
});

describe("countListWork", () => {
  it("splits the run into new lists and ones already mapped", () => {
    // Kings College, all four baselines: only Meetings needs making.
    expect(
      countListWork([KC], [ADMIN_G, DELIVERY_G, MEETINGS_G, "g-nonbillable"], existing),
    ).toEqual([2, 2]);
  });

  it("ignores baselines with no group", () => {
    expect(countListWork([KC], [ADMIN_G, null, undefined], existing)).toEqual([0, 1]);
  });
});
