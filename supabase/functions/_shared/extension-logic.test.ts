import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideApprovalAction, statusAfterInfoResponse } from "./extension-logic.ts";

const STAFF = { id: "staff-1", role: "staff" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };
const OWNER = { id: "owner-1", role: "owner" as const };

const row = (
  tier: "auto" | "admin" | "owner",
  status: Parameters<typeof decideApprovalAction>[0]["status"],
) => ({ tier, status, requester_id: "staff-1" });

Deno.test("owner-tier requests stop at the admin leg first", () => {
  // The whole point: Lisa signs off before it ever reaches Brendan.
  assertEquals(decideApprovalAction(row("owner", "pending_admin"), ADMIN), { action: "promote" });
  assertEquals(decideApprovalAction(row("owner", "pending_owner"), OWNER), { action: "execute" });
});

Deno.test("owner acting on the admin leg promotes rather than short-circuiting", () => {
  assertEquals(decideApprovalAction(row("owner", "pending_admin"), OWNER), { action: "promote" });
});

Deno.test("admin-tier requests execute on admin approval", () => {
  assertEquals(decideApprovalAction(row("admin", "pending_admin"), ADMIN), { action: "execute" });
});

Deno.test("admin cannot finalise a promoted owner-leg row", () => {
  const r = decideApprovalAction(row("owner", "pending_owner"), ADMIN);
  assertEquals(r.action, "denied");
});

Deno.test("staff cannot approve anything queued for a human", () => {
  assertEquals(decideApprovalAction(row("admin", "pending_admin"), STAFF).action, "denied");
  assertEquals(decideApprovalAction(row("owner", "pending_owner"), STAFF).action, "denied");
});

Deno.test("auto tier finalises for its own requester but not another staffer", () => {
  assertEquals(decideApprovalAction(row("auto", "auto_approved"), STAFF), { action: "execute" });
  assertEquals(
    decideApprovalAction(row("auto", "auto_approved"), { id: "staff-2", role: "staff" }).action,
    "denied",
  );
  assertEquals(decideApprovalAction(row("auto", "auto_approved"), ADMIN), { action: "execute" });
});

Deno.test("terminal and blocked states are refused", () => {
  assertEquals(decideApprovalAction(row("owner", "approved"), OWNER), { action: "already_approved" });
  assertEquals(decideApprovalAction(row("owner", "rejected"), OWNER).action, "denied");
  assertEquals(decideApprovalAction(row("owner", "needs_info"), OWNER).action, "denied");
});

Deno.test("info response returns to the leg that still owes a decision", () => {
  assertEquals(statusAfterInfoResponse({ admin_approved_at: null }), "pending_admin");
  assertEquals(
    statusAfterInfoResponse({ admin_approved_at: "2026-07-29T10:00:00Z" }),
    "pending_owner",
  );
});
