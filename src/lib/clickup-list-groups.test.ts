import { describe, expect, it } from "vitest";
import { groupListsByWorkStream, OTHER_GROUP } from "./clickup-list-groups";

const l = (name: string, work_stream: string | null = null) => ({ id: name, name, work_stream });

describe("groupListsByWorkStream", () => {
  it("orders streams by the canonical order, not alphabetically", () => {
    const groups = groupListsByWorkStream([
      l("SEO", "SEO"),
      l("Admin", "Admin"),
      l("Paid Media", "Paid Media"),
      l("Content", "Content"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Admin", "Content", "SEO", "Paid Media"]);
  });

  it("puts everything with no stream under Other lists, last and alphabetical", () => {
    const groups = groupListsByWorkStream([
      l("Ultimate Guide - No. 2"),
      l("SEO", "SEO"),
      l("Dashboard 1: Fulfilment"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["SEO", OTHER_GROUP]);
    expect(groups[1].options.map((o) => o.name)).toEqual([
      "Dashboard 1: Fulfilment",
      "Ultimate Guide - No. 2",
    ]);
  });

  it("drops empty groups — five lists show five headings at most, not eight", () => {
    const groups = groupListsByWorkStream([l("Admin", "Admin"), l("Web", "Development")]);
    expect(groups.map((g) => g.label)).toEqual(["Admin", "Development"]);
  });

  it("keeps BOTH lists when a client has two for one stream", () => {
    // Trellidor really does have Admin and Administration. Collapsing them
    // would hide a real ClickUp list; which one wins is an override decision.
    const groups = groupListsByWorkStream([
      l("Administration", "Admin"),
      l("Admin", "Admin"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map((o) => o.name)).toEqual(["Admin", "Administration"]);
  });

  it("treats an unrecognised stream name as no stream rather than a new heading", () => {
    const groups = groupListsByWorkStream([l("Something", "Not A Stream")]);
    expect(groups.map((g) => g.label)).toEqual([OTHER_GROUP]);
  });

  it("survives a missing work_stream field and an empty list", () => {
    expect(groupListsByWorkStream([])).toEqual([]);
    const groups = groupListsByWorkStream([{ id: "1", name: "Admin" }]);
    expect(groups.map((g) => g.label)).toEqual([OTHER_GROUP]);
  });
});

describe("standing categories (the newer template)", () => {
  it("gives Delivery, Meetings and Non-Billable their own headings, after the streams", () => {
    // Kings College's real shape: three of its lists used to land in Other.
    const groups = groupListsByWorkStream([
      l("Meetings"),
      l("SEO", "SEO"),
      l("Non-Billable"),
      l("Delivery"),
      l("Administration", "Admin"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Admin", "SEO", "Delivery", "Meetings", "Non-Billable",
    ]);
  });

  it("treats Overhead as Non-Billable — ClickUp has both names for it", () => {
    const groups = groupListsByWorkStream([l("Overhead"), l("Non-Billable")]);
    expect(groups.map((g) => g.label)).toEqual(["Non-Billable"]);
    expect(groups[0].options.map((o) => o.name)).toEqual(["Non-Billable", "Overhead"]);
  });

  it("a work stream always wins over a standing name", () => {
    // Nothing here should be able to drag a stream-resolved list out of it.
    const groups = groupListsByWorkStream([{ id: "1", name: "Delivery", work_stream: "Development" }]);
    expect(groups.map((g) => g.label)).toEqual(["Development"]);
  });

  it("still sends genuine one-offs to Other lists, last", () => {
    const groups = groupListsByWorkStream([
      l("Schools Account Management"),
      l("Meetings"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Meetings", OTHER_GROUP]);
  });
});
