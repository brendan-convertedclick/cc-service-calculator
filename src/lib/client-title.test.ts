import { describe, it, expect } from "vitest";
import { looksInternal, suggestClientTitle } from "./client-title";

// Every subject below is a real one, copied from the briefs table.
describe("suggestClientTitle", () => {
  it("strips the version suffix the team appends", () => {
    expect(
      suggestClientTitle(
        "Certifications: LPCB/Red Book, BRE, Achilles, SafeContractor, and the recent LDS accreditation need to go up on the site - DFT V1.1",
      ),
    ).toBe(
      "Certifications: LPCB/Red Book, BRE, Achilles, SafeContractor, and the recent LDS accreditation need to go up on the site",
    );
  });

  it("strips stacked QC and version markers", () => {
    expect(suggestClientTitle("Add Certification banners to homepage - DFT V1.1 (QC)")).toBe(
      "Add Certification banners to homepage",
    );
    expect(suggestClientTitle("Certifications page — Updates - REV V2.3 (QC)")).toBe(
      "Certifications page — Updates",
    );
  });

  it("handles REV without the V and with an em-dash", () => {
    expect(suggestClientTitle("Certifications page - Apply RSA Styling - REV 2.5")).toBe(
      "Certifications page - Apply RSA Styling",
    );
  });

  it("drops a redundant leading client name", () => {
    expect(
      suggestClientTitle(
        "Trellidor UK - No #1 / 5: The Ultimate Guide to Protecting Retail Stores from Repeat Break-Ins - DFT V1.1",
        "Trellidor UK",
      ),
    ).toBe("No #1 / 5: The Ultimate Guide to Protecting Retail Stores from Repeat Break-Ins");
  });

  it("leaves a client name alone when it is not a prefix", () => {
    expect(suggestClientTitle("Update the Trellidor UK footer", "Trellidor UK")).toBe(
      "Update the Trellidor UK footer",
    );
  });

  it("does not choke on regex characters in a client name", () => {
    expect(suggestClientTitle("Trellidor (PTY) LTD - Fix the header", "Trellidor (PTY) LTD")).toBe(
      "Fix the header",
    );
  });

  it("keeps parentheses that are part of the meaning", () => {
    expect(
      suggestClientTitle(
        'Fix product security level labels (currently all show "Level 3"; should be Level 1/2/3, pending correct wording + paperwork) - DFT V1.1',
      ),
    ).toBe(
      'Fix product security level labels (currently all show "Level 3"; should be Level 1/2/3, pending correct wording + paperwork)',
    );
  });

  it("returns empty for nothing usable, so the caller can demand a title", () => {
    expect(suggestClientTitle(null)).toBe("");
    expect(suggestClientTitle("   ")).toBe("");
    expect(suggestClientTitle("- DFT V1.1")).toBe("");
  });

  it("collapses whitespace", () => {
    expect(suggestClientTitle("Add   blogs  and case studies")).toBe("Add blogs and case studies");
  });
});

describe("looksInternal", () => {
  it("flags leftovers a human should fix before a client sees them", () => {
    expect(looksInternal("Certifications page — Export Assets - DFT V1.1")).toBe(true);
    expect(looksInternal("Add blogs x10 (QC)")).toBe(true);
    expect(looksInternal("Certifications page wording")).toBe(false);
  });
});
