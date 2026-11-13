import { describe, expect, it } from "vitest";
import { adhocName, canBook, canConvertToAdhoc, groupOutside, totalOutside, type OutsideRow } from "./retainer-outside";

const row = (o: Partial<OutsideRow>): OutsideRow => ({
  client_id: "c1", client_name: "Dovetail RSA", clickup_task_id: "t1", task_name: "x",
  reason: "meeting", hours: 1, brief_id: null, brief_billing_type: null, meeting_id: "m1", ongoing_task_id: null,
  dismissed_at: null, dismissed_by_name: null,
  ...o,
});

describe("groupOutside", () => {
  it("puts leaks in their own columns, keeps ad hoc, archived and dismissed out of the hidden total", () => {
    const out = groupOutside([
      row({ hours: "0.75" }),
      row({ clickup_task_id: "t2", reason: "adhoc", hours: 3, brief_id: "b2", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t3", reason: "internal", hours: 2.5, brief_id: "b3", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t4", reason: "unlinked", hours: 1, brief_id: "b4", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t5", reason: "archived", hours: 4, brief_id: "b5", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t6", reason: "internal", hours: 2, brief_id: "b6", meeting_id: null, dismissed_at: "2026-11-13T10:00:00Z" }),
    ]);
    expect(out.map((c) => c.clientName)).toEqual(["Trellidor", "Dovetail RSA"]);
    expect(out[0]).toMatchObject({ internal: 2.5, other: 1, hidden: 3.5, archived: 4, dismissed: 2 });
    expect(out[1]).toMatchObject({ meeting: 0.75, hidden: 0.75, adhoc: 3 });
    expect(totalOutside(out)).toMatchObject({ hidden: 4.25, adhoc: 3, dismissed: 2 });
  });

  it("offers the fixes only on undismissed leaks, and ad hoc only on briefs", () => {
    expect(canBook(row({}))).toBe(true);
    expect(canConvertToAdhoc(row({}))).toBe(false);
    expect(canConvertToAdhoc(row({ reason: "internal", brief_id: "b", meeting_id: null }))).toBe(true);
    expect(canBook(row({ reason: "adhoc", brief_id: "b", meeting_id: null }))).toBe(false);
    expect(canBook(row({ dismissed_at: "2026-11-13T10:00:00Z" }))).toBe(false);
  });

  it("prefixes [Ad Hoc] once", () => {
    expect(adhocName("Layby page")).toBe("[Ad Hoc] Layby page");
    expect(adhocName("[Ad Hoc] Layby page")).toBe("[Ad Hoc] Layby page");
  });
});
