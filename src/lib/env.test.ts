import { describe, expect, it, vi, afterEach } from "vitest";
import { isLocalDev } from "./env";

function onHost(hostname: string) {
  vi.stubGlobal("window", { location: { hostname } });
}

afterEach(() => vi.unstubAllGlobals());

describe("isLocalDev", () => {
  it("is true on localhost under the dev server", () => {
    onHost("localhost");
    expect(isLocalDev()).toBe(true);
  });

  // The bypass auto-logs in as the shared owner account. The dev server is
  // publicly reachable through the cloudflared tunnel, so any hostname that
  // isn't literally local must fail this — including a prod-lookalike.
  it.each(["conductor-dev.convertedclick.co.za", "conductor.convertedclick.co.za"])(
    "is false on the public host %s",
    (host) => {
      onHost(host);
      expect(isLocalDev()).toBe(false);
    },
  );
});
