// The app's sanitiser and the edge function's copy must not drift.
//
// suggestClientTitle exists twice — src/lib/client-title.ts for the app,
// supabase/functions/_shared/client-title.ts for Deno, which cannot import
// from src/. The edge function runs the Deno copy on `briefs.raw_subject`
// before that subject reaches a client, so a difference between the two is not
// a tidiness problem: it is "DFT V1.1" on a client's screen in production
// while the staff preview reads clean.
//
// These are real subjects off the live table.

import { describe, it, expect } from "vitest";
import { suggestClientTitle, UNTITLED_WORK } from "./client-title";
import {
  suggestClientTitle as denoSuggest,
  UNTITLED_WORK as DENO_UNTITLED,
} from "../../supabase/functions/_shared/client-title";

const REAL_SUBJECTS: [string, string | null][] = [
  ["Stanton Global Website Rebuild in Elementor - DFT V1.1 (QC)", "Pimms"],
  ["Tego Plastics Website - SEO Audit - DFT V1.1", "Pimms"],
  ["Pimms - Prepare PPC Report for Quarterly Marketing Meeting - DFT V1.1", "Pimms"],
  ["Pimms - Quarterly Marketing Meeting - DFT V1.1", "Pimms"],
  ["Pimms WP Forms Pipedrive", "Pimms"],
  ["Ultimate Guides", "Pimms"],
  ["Case Studies", "Pimms"],
  ["Trellidor UK - No #1 / 5: The Ultimate Guide - Exports Static Mock Up Assets - DFT V1.1", "Trellidor UK"],
  ["Add Certification banners to homepage - DFT V1.1 (QC)", "Trellidor"],
  ["", null],
  ["   ", null],
  ["- DFT V1.1", null],
];

describe("client-title mirror", () => {
  it("the app copy and the Deno copy agree on every real subject", () => {
    for (const [subject, client] of REAL_SUBJECTS) {
      expect(denoSuggest(subject, client), subject).toBe(suggestClientTitle(subject, client));
    }
    expect(DENO_UNTITLED).toBe(UNTITLED_WORK);
  });

  it("leaves no version or QC marker on anything a client would read", () => {
    for (const [subject, client] of REAL_SUBJECTS) {
      const title = suggestClientTitle(subject, client) || UNTITLED_WORK;
      expect(title, subject).not.toMatch(/DFT|\(\s*QC\s*\)|V\d+\.\d+/i);
    }
  });

  it("never returns an empty label for the client's page", () => {
    // A subject that sanitises to nothing must become a neutral line, never a
    // dropped row: a task hidden from the client is the bug this path fixes.
    expect(suggestClientTitle("- DFT V1.1") || UNTITLED_WORK).toBe(UNTITLED_WORK);
  });
});
