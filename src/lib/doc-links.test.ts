import { describe, expect, it } from "vitest";
import { normaliseDocLink } from "@/lib/doc-links";

describe("normaliseDocLink", () => {
  it("keeps a full http(s) URL", () => {
    expect(normaliseDocLink("https://docs.google.com/document/d/abc")).toBe(
      "https://docs.google.com/document/d/abc",
    );
    expect(normaliseDocLink("http://wiki.internal.co.za/page")).toBe("http://wiki.internal.co.za/page");
  });

  it("assumes https when someone pastes without a scheme", () => {
    // The common paste. Without this it would ship into the ClickUp markdown as
    // unclickable plain text.
    expect(normaliseDocLink("docs.google.com/document/d/abc")).toBe(
      "https://docs.google.com/document/d/abc",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseDocLink("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  it("rejects anything that isn't a reachable web document", () => {
    expect(normaliseDocLink("")).toBeNull();
    expect(normaliseDocLink("   ")).toBeNull();
    // No dot in the host — parses as a URL, is not a document anyone can open.
    expect(normaliseDocLink("https://notes")).toBeNull();
    // Non-web schemes must not reach the task description.
    expect(normaliseDocLink("javascript:alert(1)")).toBeNull();
    expect(normaliseDocLink("mailto:someone@example.com")).toBeNull();
    expect(normaliseDocLink("file:///Users/me/secret.txt")).toBeNull();
    // Credentials render into a description other people read.
    expect(normaliseDocLink("https://user:pass@example.com/doc")).toBeNull();
  });

  it("still reads a scheme-less host:port as a host, not a scheme", () => {
    expect(normaliseDocLink("wiki.internal.co.za:8080/page")).toBe(
      "https://wiki.internal.co.za:8080/page",
    );
  });
});
