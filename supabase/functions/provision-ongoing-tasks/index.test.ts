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

Deno.test("buildTaskName formats client-scoped tasks with short_name", () => {
  assertEquals(
    buildTaskName(
      { full_name: "Brendan Gunn" },
      { label: "Client Meeting", label_key: "client-meeting" },
      { short_name: "Acme", name: "Acme Industrial (Pty) Ltd" },
    ),
    "[Ongoing] Brendan Gunn — Acme — Client Meeting",
  );
});

Deno.test("buildTaskName falls back to name when short_name missing", () => {
  assertEquals(
    buildTaskName(
      { full_name: "Brendan Gunn" },
      { label: "Reactive", label_key: "reactive" },
      { name: "Acme" },
    ),
    "[Ongoing] Brendan Gunn — Acme — Reactive",
  );
});
