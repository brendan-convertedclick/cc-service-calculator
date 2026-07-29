import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isLocalDev } from "@/lib/env";

// Auto-login as the shared team account is a LOCAL-DEV convenience only —
// otherwise prod would force everyone onto team@ and block real per-user logins.
const DEV_AUTO_LOGIN = isLocalDev();
const DEV_EMAIL = "team@convertedclick.co.za";
const DEV_PASSWORD = "cc-calc-2026-temp";

// Google's provider_refresh_token is only ever present on the session object
// itself (never re-fetchable, never refreshed by Supabase) — but auth-js
// re-emits it on every INITIAL_SESSION / recovered-session event, not just on
// a fresh OAuth sign-in, and does so twice under React 18 StrictMode. This
// module-scope guard (survives the double-mount, unlike a ref) makes sure we
// only POST a given refresh token to google-token once.
let lastStoredProviderToken: string | null = null;

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
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [domainError, setDomainError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }
      if (DEV_AUTO_LOGIN) {
        const { data: signed } = await supabase.auth.signInWithPassword({
          email: DEV_EMAIL,
          password: DEV_PASSWORD,
        });
        if (cancelled) return;
        setSession(signed.session ?? null);
      }
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
      if (s?.provider_refresh_token && s.provider_refresh_token !== lastStoredProviderToken) {
        lastStoredProviderToken = s.provider_refresh_token;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
          body: JSON.stringify({
            action: 'store',
            provider_refresh_token: s.provider_refresh_token,
            provider_token: s.provider_token,
            expires_in: s.expires_in,
          }),
        }).catch(() => {});
      }
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
    const authUserId = session?.user?.id ?? null;
    let cancelled = false;
    (async () => {
      // First check: is there ANY team_members row for this email (active or archived)?
      const { data: anyRow } = await supabase
        .from("team_members")
        .select("id, archived_at, auth_user_id")
        .eq("email", email)
        .maybeSingle();

      if (cancelled) return;

      if (anyRow) {
        // Active member → resolve their id; archived member → null (don't re-provision)
        setCurrentUserId(anyRow.archived_at === null ? anyRow.id : null);
        // Backfill auth_user_id on first sign-in so Team page "Active" status and
        // RLS's current_team_member_id() (which checks auth_user_id first) work.
        if (authUserId && anyRow.auth_user_id !== authUserId) {
          await supabase.from("team_members").update({ auth_user_id: authUserId }).eq("id", anyRow.id);
        }
        return;
      }

      // No row at all — auto-provision for real company accounts only
      if (email.endsWith('@convertedclick.co.za') && email !== 'team@convertedclick.co.za') {
        const fullName =
          session?.user?.user_metadata?.full_name ??
          session?.user?.user_metadata?.name ??
          email;
        const { data: upserted } = await supabase
          .from("team_members")
          .upsert({ full_name: fullName, email, auth_user_id: authUserId }, { onConflict: 'email', ignoreDuplicates: false })
          .select("id")
          .single();
        if (!cancelled) setCurrentUserId(upserted?.id ?? null);
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
    signIn: (email, password) => {
      setDomainError(false);
      return supabase.auth.signInWithPassword({ email, password });
    },
    signInWithGoogle: () => {
      setDomainError(false);
      return supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          // calendar.events lets staff schedule internal meetings on their own
          // calendar (see google-token/index.ts + _shared/google-token.ts).
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          queryParams: {
            hd: 'convertedclick.co.za',
            access_type: 'offline',
            // Required to guarantee a refresh_token even on repeat consent —
            // without it Google omits refresh_token after the first grant.
            prompt: 'consent',
          },
        },
      });
    },
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
