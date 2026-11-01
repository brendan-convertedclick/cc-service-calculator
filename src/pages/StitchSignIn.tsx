import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

/**
 * "Sign in with Stitch" (OpenID Connect, PKCE). Both legs live here:
 *   - no `code`: start. The login page's button, and Stitch's launcher
 *     (Stitch's app URL for Conductor is this page, so a launch signs you in).
 *   - `code`: back from Stitch. The `stitch-sso` edge function redeems it and
 *     returns a magic-link token_hash for the auth user Stitch provisioned,
 *     which becomes a normal Supabase session. AuthProvider takes it from there.
 * Google and password sign-in are untouched; this is one more door.
 */

const STITCH: string = import.meta.env.VITE_STITCH_ORIGIN ?? "https://stitch.net.za";
const SSO_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stitch-sso`;
const KEY = "conductor:stitch-sso";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri = () => `${window.location.origin}/auth/stitch`;

async function start() {
  const verifier = random();
  const state = random();
  sessionStorage.setItem(KEY, JSON.stringify({ verifier, state }));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = new URL("/oauth/authorize", STITCH);
  url.search = new URLSearchParams({
    client_id: "conductor",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(url.toString());
}

const MESSAGES: Record<string, string> = {
  access_denied: "Your Stitch account doesn't have Conductor. Ask an admin to give you access in Stitch.",
  not_set_up: "Your Stitch account isn't linked to Conductor yet. Ask an admin, or sign in with Google instead.",
};
const FALLBACK = "Signing in with Stitch did not work. Try again, or sign in with Google.";

async function finish(code: string, state: string | null) {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { verifier: string; state: string } | null;
  sessionStorage.removeItem(KEY);
  if (!saved || saved.state !== state) throw new Error(FALLBACK);

  const res = await fetch(SSO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ code, code_verifier: saved.verifier, redirect_uri: redirectUri() }),
  });
  const body = (await res.json().catch(() => ({}))) as { token_hash?: string; error?: string };
  if (!body.token_hash) throw new Error(MESSAGES[body.error ?? ""] ?? FALLBACK);

  const { error } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type: "magiclink" });
  if (error) throw new Error(FALLBACK);
}

export function StitchSignIn() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Once: StrictMode's second run would find the URL already cleaned and start over.
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stitchError = params.get("error");
    // The code is single use, but keep it out of history and referrers anyway.
    window.history.replaceState(null, "", "/auth/stitch");

    if (stitchError) setError(MESSAGES[stitchError] ?? FALLBACK);
    else if (code)
      finish(code, params.get("state")).then(
        () => window.location.replace("/"),
        (e: Error) => setError(e.message),
      );
    else void start();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-m-surface-container-low p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <img src="/conductor-mark-v2.png" alt="Conductor" className="mx-auto h-12 w-12 object-contain" />
        <h1 className="text-headline-small text-m-on-surface">
          {error ? "Could not sign you in" : "Signing you in with Stitch…"}
        </h1>
        {error && (
          <>
            <p className="text-body-small text-destructive">{error}</p>
            <Button asChild variant="outline">
              <a href="/login">Back to sign-in</a>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
