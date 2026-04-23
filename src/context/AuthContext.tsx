import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
  /** team_members.id resolved from the signed-in auth.users email.
   * Written to briefs.triaged_by, scopes.locked_by, quotes.accepted_by.
   * Null if no team_members row matches the session email — FKs are on delete set null. */
  currentUserId: string | null;
  signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>;
  signOut: () => ReturnType<typeof supabase.auth.signOut>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
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
    supabase
      .from("team_members")
      .select("id")
      .eq("email", email)
      .is("archived_at", null)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCurrentUserId(data?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email]);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    currentUserId,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
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
