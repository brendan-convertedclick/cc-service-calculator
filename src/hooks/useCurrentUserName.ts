/**
 * Phase 1 attribution stub. Returns the name string used in
 * briefs.triaged_by, scopes.locked_by, quotes.accepted_by.
 *
 * When per-user Supabase auth lands, swap this implementation for one
 * that reads the session user's profile; call sites stay unchanged.
 */
export function useCurrentUserName(): string {
  return "Brendan";
}
