/**
 * Token-level Jaccard similarity used by the Scope page to decide whether
 * scopes.ai_drafted stays true after staff edits. Threshold default 0.85
 * matches spec §7.4 ("≥85% AI draft").
 *
 * Tokenisation: lowercase, strip punctuation (any non-letter/digit in any
 * Unicode script), split on whitespace. Empty tokens dropped.
 */

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function isMostlyAi(current: string, lastAiDraft: string, threshold = 0.85): boolean {
  return jaccard(current, lastAiDraft) >= threshold;
}
