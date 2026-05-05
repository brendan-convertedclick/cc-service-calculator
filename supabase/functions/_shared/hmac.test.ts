import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hmacSign,
  hmacVerify,
  newPlaintextToken,
  timingSafeEqualHex,
} from "./hmac.ts";

Deno.test("hmacSign produces a 64-char hex string deterministically", async () => {
  const sig = await hmacSign("hello world", "shhh");
  assertEquals(sig.length, 64);
  assertEquals(/^[0-9a-f]+$/.test(sig), true);
  assertEquals(await hmacSign("hello world", "shhh"), sig);
});

Deno.test("hmacSign differs for different bodies", async () => {
  const a = await hmacSign("a", "k");
  const b = await hmacSign("b", "k");
  assertNotEquals(a, b);
});

Deno.test("hmacVerify accepts the matching signature", async () => {
  const sig = await hmacSign("payload", "secret");
  assertEquals(await hmacVerify("payload", sig, "secret"), true);
});

Deno.test("hmacVerify rejects a tampered signature", async () => {
  const sig = await hmacSign("payload", "secret");
  const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assertEquals(await hmacVerify("payload", tampered, "secret"), false);
});

Deno.test("hmacVerify rejects when the secret is wrong", async () => {
  const sig = await hmacSign("payload", "secret-a");
  assertEquals(await hmacVerify("payload", sig, "secret-b"), false);
});

Deno.test("timingSafeEqualHex returns false for different lengths", () => {
  assertEquals(timingSafeEqualHex("abc", "abcd"), false);
});

Deno.test("timingSafeEqualHex returns true for identical strings", () => {
  assertEquals(timingSafeEqualHex("deadbeef", "deadbeef"), true);
});

Deno.test("newPlaintextToken returns a long base64url string", () => {
  const t = newPlaintextToken();
  assertEquals(t.length >= 40, true);
  assertEquals(/^[A-Za-z0-9_-]+$/.test(t), true);
});
