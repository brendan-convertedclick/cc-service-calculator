// Pure logic for approve-revision-request, split out so it's Deno-testable
// without spinning up the edge function.

// Matches an existing "DFT V1.1" / "REV V1.1" / "REV 2.1"-style stage marker
// anywhere in the task name (case-insensitive). Replacing just this span
// (not everything after it) keeps trailing annotations like "(QC)" intact.
const SUFFIX_RE = /(DFT|REV)\s*V?\d+(?:\.\d+)?/gi;

/**
 * Swap the last DFT/REV stage marker in a task name for the new one. If the
 * name has no existing marker, appends " - {newSuffix}" instead.
 */
export function swapRevisionSuffix(name: string, newSuffix: string): string {
  const matches = [...name.matchAll(SUFFIX_RE)];
  if (matches.length === 0) return `${name} - ${newSuffix}`;
  const last = matches[matches.length - 1];
  const start = last.index ?? 0;
  const end = start + last[0].length;
  return name.slice(0, start) + newSuffix + name.slice(end);
}
