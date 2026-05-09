import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const DEV_SESSION = import.meta.env.DEV
  ? ({ user: { id: "dev", email: "team@convertedclick.co.za" } } as unknown as Session)
  : null;

type AuthContextValue = {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
  domainError: boolean;
  /** team_members.id resolved from the signed-in auth.users email.
   * Written to briefs.triaged_by, scopes.locked_by, quotes.accepted_by.
   * Null if no team_members row matches the session email — FKs are on delete set null. */
  currentUserId: string | null;
  signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>;
  signInWithGoogle: () => ReturnType<typeof supabase.auth.signInWithOAuth>;
  signOut: () => ReturnType<typeof supabase.auth.signOut>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(DEV_SESSION);
  const [loading, setLoading] = useState(!import.meta.env.DEV);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [domainError, setDomainError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
      if (s?.user?.email && !s.user.email.endsWith('@convertedclick.co.za')) {
        supabase.auth.signOut();
        setDomainError(true);
        return;
      }
      setDomainError(false);
      setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) {
      setCurrentUserId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("id")
        .eq("email", email)
        .is("archived_at", null)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        setCurrentUserId(data.id);
        return;
      }

      // Auto-provision: only for real company accounts, not the shared login
      if (email.endsWith('@convertedclick.co.za') && email !== 'team@convertedclick.co.za') {
        const fullName =
          session?.user?.user_metadata?.full_name ??
          session?.user?.user_metadata?.name ??
          email;
        const { data: newMember } = await supabase
          .from("team_members")
          .insert({ full_name: fullName, email })
          .select("id")
          .single();
        if (!cancelled) setCurrentUserId(newMember?.id ?? null);
      } else {
        setCurrentUserId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.email]);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    domainError,
    currentUserId,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signInWithGoogle: () =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { hd: 'convertedclick.co.za' },
        },
      }),
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useCurrentUserId(): string | null {
  return useAuth().currentUserId;
}
