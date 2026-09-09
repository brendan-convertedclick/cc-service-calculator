// supabase/functions/_shared/client-title.ts
//
// MIRRORS src/lib/client-title.ts. Deno cannot import from src/, which is the
// same reason the wire types are mirrored at the top of client-review's own
// file. CHANGE ONE, CHANGE BOTH — `client-title.test.ts` imports this copy
// alongside the app's and asserts they agree on the team's real subjects, so
// drift fails a test rather than putting "DFT V1.1" in front of a client.
//
// Only the pure title functions live here. The app's copy also carries
// DEFAULT_ASK, which belongs to a form no edge function renders.

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
 * words alone. Over-cleaning would silently drop meaning.
 *
 * Returns "" when nothing usable survives. On the client's page that becomes a
 * neutral label rather than a dropped row — hiding work from the client is the
 * bug this whole path exists to fix, so nothing here may make a task vanish.
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

/** What a subject that sanitises to nothing is called on the client's page. */
export const UNTITLED_WORK = "A piece of work";
