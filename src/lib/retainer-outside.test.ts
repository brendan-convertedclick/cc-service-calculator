import { describe, expect, it } from "vitest";
import { canBook, groupOutside, type OutsideRow } from "./retainer-outside";

const row = (o: Partial<OutsideRow>): OutsideRow => ({
  client_id: "c1", client_name: "Dovetail RSA", clickup_task_id: "t1", task_name: "x",
  reason: "meeting", hours: 1, brief_id: null, brief_billing_type: null, meeting_id: "m1", ongoing_task_id: null,
  ...o,
});

describe("groupOutside", () => {
  it("splits hidden, ad hoc and archived per client and puts the most hidden time first", () => {
    const out = groupOutside([
      row({ hours: "0.75" }),
      row({ clickup_task_id: "t2", reason: "adhoc", hours: 3, brief_id: "b2", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t3", reason: "internal", hours: 2.5, brief_id: "b3", meeting_id: null }),
      row({ client_id: "c2", client_name: "Trellidor", clickup_task_id: "t4", reason: "archived", hours: 1, brief_id: "b4", meeting_id: null }),
    ]);
    expect(out.map((c) => c.clientName)).toEqual(["Trellidor", "Dovetail RSA"]);
    expect(out[0]).toMatchObject({ hidden: 2.5, archived: 1, adhoc: 0, total: 3.5 });
    expect(out[1]).toMatchObject({ hidden: 0.75, adhoc: 3, total: 3.75 });
    expect(out[1].rows[0].clickup_task_id).toBe("t2");
  });

  it("only offers booking for hidden work that has a Conductor record", () => {
    expect(canBook(row({}))).toBe(true);
    expect(canBook(row({ reason: "adhoc", brief_id: "b", meeting_id: null }))).toBe(false);
    expect(canBook(row({ reason: "archived", brief_id: "b", meeting_id: null }))).toBe(false);
    expect(canBook(row({ meeting_id: null }))).toBe(false);
  });
});
