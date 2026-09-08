import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_URL } from "@/lib/env";

describe("the client-facing address", () => {
  // The browser mints review links and the edge functions mint everything
  // else, each from its own constant. They are one address; a drift between
  // them means half the emails a client gets point somewhere the other half
  // does not, and only one of those two places is being kept alive.
  it("is the same on both sides of the wire", () => {
    const helpers = readFileSync("supabase/functions/_shared/helpers.ts", "utf8");
    const edge = /export const APP_URL = "([^"]+)"/.exec(helpers)?.[1];
    expect(edge).toBe(APP_URL);
  });

  it("is production, never the dev tunnel", () => {
    expect(APP_URL).not.toContain("conductor-dev");
    expect(APP_URL).not.toContain("localhost");
    expect(APP_URL.startsWith("https://")).toBe(true);
  });
});
