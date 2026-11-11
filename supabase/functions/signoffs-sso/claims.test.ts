import { assertEquals } from "jsr:@std/assert";
import { signoffsClaimsOf } from "./claims.ts";

const ISS = "https://stitch.net.za";
const NOW = 1_800_000_000;
const jwt = (c: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;
const good = { iss: ISS, aud: "signoffs", exp: NOW + 60, org_ref: "c-1", external_id: "p-1", email: "Kate@Pimms.co" };

Deno.test("a fresh Sign-offs token gives client, contact and email", () => {
  assertEquals(signoffsClaimsOf(jwt(good), ISS, NOW), { clientId: "c-1", contactId: "p-1", email: "Kate@Pimms.co" });
});

Deno.test("a staff conductor token is rejected on audience", () => {
  assertEquals(signoffsClaimsOf(jwt({ ...good, aud: "conductor" }), ISS, NOW), null);
});

Deno.test("an aud array containing signoffs is accepted", () => {
  assertEquals(signoffsClaimsOf(jwt({ ...good, aud: ["other", "signoffs"] }), ISS, NOW)?.clientId, "c-1");
});

Deno.test("wrong issuer, expired, or a missing claim gives nothing", () => {
  for (const c of [
    { ...good, iss: "https://evil.example" },
    { ...good, exp: NOW - 1 },
    { ...good, exp: String(NOW + 60) },
    { ...good, org_ref: undefined },
    { ...good, external_id: undefined },
    { ...good, email: undefined },
    { ...good, email: "" },
  ])
    assertEquals(signoffsClaimsOf(jwt(c), ISS, NOW), null);
  assertEquals(signoffsClaimsOf("garbage", ISS, NOW), null);
});
