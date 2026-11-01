import { assertEquals } from "jsr:@std/assert";
import { externalIdOf, nameOf } from "./claims.ts";

const ISS = "https://stitch.net.za";
const NOW = 1_800_000_000;
const jwt = (c: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const good = { iss: ISS, aud: "conductor", exp: NOW + 60, external_id: "u-1" };

Deno.test("a fresh Conductor token gives its external_id", () => {
  assertEquals(externalIdOf(jwt(good), ISS, NOW), "u-1");
});

Deno.test("anything else gives nothing", () => {
  for (const c of [
    { ...good, iss: "https://evil.example" },
    { ...good, aud: "quartz" },
    { ...good, exp: NOW - 1 },
    { ...good, external_id: null },
  ])
    assertEquals(externalIdOf(jwt(c), ISS, NOW), null);
  assertEquals(externalIdOf("garbage", ISS, NOW), null);
});

Deno.test("nameOf reads the trimmed name, or null", () => {
  assertEquals(nameOf(jwt({ name: "  Brendan Gunn " })), "Brendan Gunn");
  assertEquals(nameOf(jwt({ name: " " })), null);
  assertEquals(nameOf("garbage"), null);
});
