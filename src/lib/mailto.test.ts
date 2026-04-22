import { describe, expect, it } from "vitest";
import { mailto } from "./mailto";

describe("mailto", () => {
  it("builds a basic mailto URL", () => {
    expect(mailto({ to: "a@b.com", subject: "Hi", body: "Hello" })).toBe(
      "mailto:a@b.com?subject=Hi&body=Hello",
    );
  });

  it("URL-encodes subject and body", () => {
    const url = mailto({
      to: "a@b.com",
      subject: "Re: cost & timeline?",
      body: "Line 1\nLine 2",
    });
    expect(url).toContain("subject=Re%3A%20cost%20%26%20timeline%3F");
    expect(url).toContain("body=Line%201%0ALine%202");
  });

  it("omits empty fields", () => {
    expect(mailto({ to: "a@b.com" })).toBe("mailto:a@b.com");
  });
});
