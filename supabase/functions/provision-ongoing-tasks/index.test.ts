// supabase/functions/provision-ongoing-tasks/index.test.ts
import { assertEquals } from "jsr:@std/assert";
import { buildTaskName } from "./index.ts";

Deno.test("buildTaskName formats predictably for Rize matching", () => {
  assertEquals(
    buildTaskName({ full_name: "Brendan Gunn" }, { label: "Standup", label_key: "standup" }),
    "[Internal] Brendan Gunn — Standup",
  );
  assertEquals(
    buildTaskName({ full_name: "Tessa N." }, { label: "Admin / Comms", label_key: "admin-comms" }),
    "[Internal] Tessa N. — Admin / Comms",
  );
});
