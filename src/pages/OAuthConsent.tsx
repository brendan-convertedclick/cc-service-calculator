// /oauth/consent: the screen claude.ai sends someone to when they add Conductor
// as a connector. Supabase Auth's OAuth 2.1 server is the authorization
// server; this page is only the "allow this app?" step it delegates to us
// (Authentication → OAuth Server → Authorization path in the dashboard).
//
// Outside <RequireAuth> because it must keep its ?authorization_id through a
// sign-in: password sign-in returns via router state, Google and Stitch via
// rememberOAuthReturn (see src/lib/oauth-return.ts).
//
// What the person is agreeing to is said in words, not scopes: the connector
// acts as them, sees what they can see, and can create ClickUp tasks. That is
// the whole grant — conductor-mcp runs every query under their own session.

import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { clearOAuthReturn, rememberOAuthReturn } from "@/lib/oauth-return";
import { errorMessage } from "@/lib/utils";

type Details = { authorization_id: string; client: { name: string; uri: string }; user: { email: string } };

export function OAuthConsent() {
  const { session, loading } = useAuth();
  const loc = useLocation();
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    if (session) clearOAuthReturn();
  }, [session]);

  useEffect(() => {
    if (!session || !authorizationId) return;
    let live = true;
    void (async () => {
      const { data, error: e } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!live) return;
      if (e) return setError(e.message);
      // Already agreed earlier: Supabase hands back where to go next.
      if (data && "redirect_url" in data && data.redirect_url && !("authorization_id" in data)) {
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data as unknown as Details);
    })();
    return () => {
      live = false;
    };
  }, [session, authorizationId]);

  if (loading) return <Shell><Loader2 className="h-5 w-5 animate-spin text-m-on-surface-variant" /></Shell>;

  if (!session) {
    const here = loc.pathname + loc.search;
    rememberOAuthReturn(here);
    return <Navigate to="/login" replace state={{ from: here }} />;
  }

  async function decide(kind: "approve" | "deny") {
    setBusy(kind);
    setError(null);
    try {
      const { data, error: e } = kind === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (e) throw e;
      if (data?.redirect_url) window.location.assign(data.redirect_url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <Shell>
      <Card className="w-full max-w-md shadow-elev-2">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <img src="/conductor-mark-v2.png" alt="Conductor" className="h-10 w-10 shrink-0 object-contain" />
            <PlugZap className="h-5 w-5 text-m-on-surface-variant" aria-hidden />
          </div>
          <CardTitle className="text-headline-small">
            Connect {details?.client.name ?? "this app"} to Conductor?
          </CardTitle>
          <CardDescription>
            Signed in as {details?.user.email ?? session.user.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authorizationId ? (
            <p className="text-body-medium text-m-on-surface">
              This link is missing its request. Start again from the app you were connecting.
            </p>
          ) : !details && !error ? (
            <Loader2 className="h-5 w-5 animate-spin text-m-on-surface-variant" />
          ) : details ? (
            <>
              <ul className="list-disc space-y-1 pl-5 text-body-medium text-m-on-surface">
                <li>It acts as you, and sees only what you can see in Conductor.</li>
                <li>It can read clients, retainers, briefs and sign-offs.</li>
                <li>It can record briefs and create their ClickUp tasks in your name.</li>
                <li>It cannot send anything to a client. Sign-offs still wait for Send.</li>
              </ul>
              <p className="text-body-small text-m-on-surface-variant">
                You can disconnect it at any time from the app's connector settings.
              </p>
            </>
          ) : null}
          {error && <p className="text-body-small text-destructive">{error}</p>}
          {details && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!!busy} onClick={() => void decide("deny")}>
                {busy === "deny" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Don't allow
              </Button>
              <Button disabled={!!busy} onClick={() => void decide("approve")}>
                {busy === "approve" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Allow
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-m-surface-container-low p-4">{children}</div>
  );
}
