import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import type { TeamMemberRole } from "@/types/staff-briefs";

const SHARED_DEV_EMAIL = "team@convertedclick.co.za";

/**
 * Resolves the current user's team_members.role.
 *
 * Special cases:
 * - Loading: returns null with isLoading=true.
 * - Shared dev login (team@convertedclick.co.za): treated as 'owner' for dev
 *   ergonomics — the shared account has no team_members row by design.
 * - No matching team_members row: returns null (treated as no access by
 *   route gates; admin/owner gates close, staff gate also closes).
 */
export function useCurrentRole(): { role: TeamMemberRole | null; isLoading: boolean } {
  const { session, loading } = useAuth();
  const [role, setRole] = useState<TeamMemberRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (loading) return;
    const email = session?.user?.email;
    if (!email) {
      setRole(null);
      setIsLoading(false);
      return;
    }
    if (email === SHARED_DEV_EMAIL) {
      setRole("owner");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("role")
        .eq("email", email)
        .maybeSingle();
      if (cancelled) return;
      setRole((data?.role as TeamMemberRole) ?? null);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, loading]);

  return { role, isLoading };
}
