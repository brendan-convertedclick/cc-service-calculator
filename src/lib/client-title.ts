// src/lib/client-title.ts
//
// Turning an internal brief subject into something a client can read.
//
// Real subjects look like this:
//   Certifications: LPCB/Red Book, BRE, Achilles… need to go up on the site - DFT V1.1
//   Add Certification banners to homepage - DFT V1.1 (QC)
//   Trellidor UK - No #1 / 5: The Ultimate Guide… - Exports Static Mock Up Assets - DFT V1.1
//
// None of that can go in front of a client. This produces a SUGGESTION only —
// the seeding UI puts it in an editable field and a human confirms it before
// any row is written. Nothing here is ever published unreviewed, because a
// regex cannot know that "Exports Static Mock Up Assets" means "the design
// mock-up" to the person reading it.

/** Version/stage markers the team appends: "- DFT V1.1", "— REV V2.3", "- DFT 2". */
const VERSION_SUFFIX = /\s*[-–—]\s*(DFT|REV)\s*V?\s*\d+(?:\.\d+)*\s*$/i;

/** A trailing "(QC)" / "(qc)" quality-check marker. */
const QC_SUFFIX = /\s*\(\s*QC\s*\)\s*$/i;

/** Collapse runs of whitespace and trim. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Strip the internal noise from a brief subject.
 *
 * Deliberately conservative: it removes markers the team demonstrably appends
 * (version tags, QC flags, a leading client-name prefix) and leaves the actual
 * words alone. Over-cleaning would silently drop meaning, and the human is
 * editing this anyway.
 *
 * Returns "" when nothing usable survives, so the caller can require a title
 * rather than writing an empty one.
 */
export function suggestClientTitle(rawSubject: string | null, clientName?: string | null): string {
  if (!rawSubject) return "";
  let s = tidy(rawSubject);

  // Suffixes can stack: "… - DFT V1.1 (QC)". Peel until nothing more comes off.
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(QC_SUFFIX, "");
    s = s.replace(VERSION_SUFFIX, "");
    if (s === before) break;
  }

  // "Trellidor UK - No #1 / 5: …" → drop the redundant client-name prefix.
  // The client knows who they are; the page is already headed with their name.
  if (clientName) {
    const escaped = clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^${escaped}\\s*[-–—:]\\s*`, "i"), "");
  }

  return tidy(s);
}

/**
 * A starting point for the one-line ask. Intentionally generic — the whole
 * value of the ask is that a person wrote it for this item, so this is a
 * placeholder that reads as unfinished rather than a plausible-looking
 * sentence someone might ship without reading.
 */
export const DEFAULT_ASK = "";

/** True when a suggestion still carries obvious internal noise. */
export function looksInternal(title: string): boolean {
  return /\bDFT\b|\bREV\b|\(\s*QC\s*\)|\bV\d+\.\d+\b/i.test(title);
}
