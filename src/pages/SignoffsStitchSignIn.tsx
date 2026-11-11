import { useEffect, useRef, useState } from "react";
import { reviewPathFor } from "@/lib/signoffs-stitch";

/**
 * "Sign in with Stitch" for a client's Sign-offs (OpenID Connect, PKCE), the
 * client-side twin of StitchSignIn. Both legs live here:
 *   - no `code`: start. Stitch's launcher and "waiting on you" links point here,
 *     optionally with `?item=<id>`, which is kept in sessionStorage because the
 *     redirect_uri registered with Stitch is the bare page.
 *   - `code`: back from Stitch. `signoffs-sso` redeems it and returns a personal
 *     review token, and we replace this page with /review/<token>.
 * Never falls back to a company-wide link: no token, no review.
 */

const STITCH: string = import.meta.env.VITE_STITCH_ORIGIN ?? "https://stitch.net.za";
const SSO_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signoffs-sso`;
const KEY = "conductor:signoffs-sso";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri = () => `${window.location.origin}/signoffs/stitch`;

async function start(item: string | null) {
  const verifier = random();
  const state = random();
  sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, item }));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = new URL("/oauth/authorize", STITCH);
  url.search = new URLSearchParams({
    client_id: "signoffs",
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
  access_denied: "Your Stitch account doesn't have Sign-offs yet. Ask us in Stitch.",
  not_set_up: "We haven't finished setting you up. Ask us in Stitch.",
};
const FALLBACK = "Signing in did not work. Try again from Stitch.";

async function finish(code: string, state: string | null) {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
    verifier: string;
    state: string;
    item: string | null;
  } | null;
  sessionStorage.removeItem(KEY);
  if (!saved || saved.state !== state) throw new Error(FALLBACK);

  const res = await fetch(SSO_URL, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ code, code_verifier: saved.verifier, redirect_uri: redirectUri() }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!body.token) throw new Error(MESSAGES[body.error ?? ""] ?? FALLBACK);
  return reviewPathFor(body.token, saved.item);
}

export function SignoffsStitchSignIn() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Once: StrictMode's second run would find the URL already cleaned and start over.
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stitchError = params.get("error");
    const item = params.get("item");
    // The code is single use, but keep it out of history and referrers anyway.
    window.history.replaceState(null, "", "/signoffs/stitch");

    if (stitchError) setError(MESSAGES[stitchError] ?? FALLBACK);
    else if (code)
      finish(code, params.get("state")).then(
        (path) => window.location.replace(path),
        (e: Error) => setError(e.message),
      );
    else void start(item);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-m-surface-container-low p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-headline-small text-m-on-surface">
          {error ? "Could not sign you in" : "Opening your sign-offs…"}
        </h1>
        {error && <p className="text-body-small text-destructive">{error}</p>}
        <p className="text-body-small text-m-on-surface-variant">Converted Click</p>
      </div>
    </div>
  );
}
