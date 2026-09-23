// supabase/functions/provision-ongoing-tasks/index.test.ts
import { assertEquals } from "jsr:@std/assert";
import { buildTaskName } from "./index.ts";

Deno.test("buildTaskName formats overhead tasks predictably", () => {
  assertEquals(
    buildTaskName({ full_name: "Brendan Gunn" }, { label: "Standup", label_key: "standup" }),
    "[Internal] Brendan Gunn — Standup",
  );
  assertEquals(
    buildTaskName({ full_name: "Tessa N." }, { label: "Admin / Comms", label_key: "admin-comms" }),
    "[Internal] Tessa N. — Admin / Comms",
  );
});

Deno.test("buildTaskName names a client task by its category alone", () => {
  // The list says which client; the assignees say who.
  assertEquals(
    buildTaskName(
      { full_name: "Brendan Gunn" },
      { label: "Sales", label_key: "client-sales" },
      { short_name: "Acme", name: "Acme Industrial (Pty) Ltd" },
    ),
    "[Ongoing] Sales",
  );
});
