import { describe, expect, it } from "vitest";
import {
  askIndex,
  occurrenceTitle,
  occurrencesBetween,
  soonList,
  weekStart,
  type Moment,
} from "@/lib/contact-moments";

const moment = (over: Partial<Moment> = {}): Moment => ({
  id: "m1",
  contact_id: "c1",
  client_id: "s1",
  kind: "birthday",
  title: null,
  on_date: "1980-10-04",
  repeats_yearly: true,
  ask_about: null,
  notes: null,
  created_by: null,
  contactName: "Thandi Mokoena",
  contactRole: "Head of Marketing",
  clientName: "Kings College",
  ...over,
});

describe("occurrencesBetween", () => {
  it("repeats a birthday every year in range", () => {
    const occ = occurrencesBetween([moment()], "2026-01-01", "2027-12-31");
    expect(occ.map((o) => o.date)).toEqual(["2026-10-04", "2027-10-04"]);
  });

  it("never repeats before the year it was first set", () => {
    const occ = occurrencesBetween(
      [moment({ kind: "anniversary", title: "Joined the school", on_date: "2026-03-01" })],
      "2025-01-01",
      "2027-12-31",
    );
    expect(occ.map((o) => o.date)).toEqual(["2026-03-01", "2027-03-01"]);
    expect(occ.map((o) => o.nth)).toEqual([0, 1]);
  });

  it("puts a one-off event on its day only", () => {
    const e = moment({ kind: "event", title: "Matric dance", on_date: "2026-10-17", repeats_yearly: false });
    expect(occurrencesBetween([e], "2026-10-01", "2026-10-31")).toHaveLength(1);
    expect(occurrencesBetween([e], "2027-10-01", "2027-10-31")).toHaveLength(0);
  });

  it("moves a 29 February birthday to the 28th in a common year", () => {
    const occ = occurrencesBetween([moment({ on_date: "2000-02-29" })], "2027-02-01", "2028-03-01");
    expect(occ.map((o) => o.date)).toEqual(["2027-02-28", "2028-02-29"]);
  });

  it("orders by date, then by person", () => {
    const occ = occurrencesBetween(
      [
        moment({ id: "b", contactName: "Zola", on_date: "1990-10-04" }),
        moment({ id: "a", contactName: "Anna", on_date: "1990-10-04" }),
        moment({ id: "c", contactName: "Mia", on_date: "1990-10-01" }),
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(occ.map((o) => o.moment.id)).toEqual(["c", "a", "b"]);
  });
});

describe("occurrenceTitle", () => {
  it("names a birthday by its person and counts anniversaries", () => {
    const [b] = occurrencesBetween([moment()], "2026-10-04", "2026-10-04");
    expect(occurrenceTitle(b)).toBe("Thandi Mokoena's birthday");
    const [a] = occurrencesBetween(
      [moment({ kind: "anniversary", title: "Principal", on_date: "2014-05-02" })],
      "2026-05-02",
      "2026-05-02",
    );
    expect(occurrenceTitle(a)).toBe("Principal · 12th");
  });
});

describe("soonList", () => {
  const today = "2026-09-30";

  it("groups the next three weeks", () => {
    const list = soonList(
      [
        moment({ id: "t", on_date: "1985-09-30" }),
        moment({ id: "w", on_date: "1985-10-03" }),
        moment({ id: "l", on_date: "1985-10-15" }),
        moment({ id: "x", on_date: "1985-11-30" }),
      ],
      new Map(),
      today,
    );
    expect(list.today.map((o) => o.moment.id)).toEqual(["t"]);
    expect(list.thisWeek.map((o) => o.moment.id)).toEqual(["w"]);
    expect(list.later.map((o) => o.moment.id)).toEqual(["l"]);
  });

  it("follows up recent events until somebody has asked how they went", () => {
    const e = moment({ id: "e", kind: "event", title: "Rugby final", on_date: "2026-09-26", repeats_yearly: false });
    const bday = moment({ id: "b", on_date: "1985-09-27" });
    expect(soonList([e, bday], new Map(), today).followUps.map((o) => o.moment.id)).toEqual(["e"]);

    const asked = askIndex([
      { moment_id: "e", occurs_on: "2026-09-26", stage: "after", asked_by: null, asked_at: "2026-09-29T08:00:00Z" },
    ]);
    expect(soonList([e], asked, today).followUps).toHaveLength(0);
  });
});

describe("weekStart", () => {
  it("is the Monday", () => {
    expect(weekStart("2026-09-30")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
  });
});
