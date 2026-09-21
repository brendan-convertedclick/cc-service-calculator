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
