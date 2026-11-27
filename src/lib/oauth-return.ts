// Where to go back to after signing in, when sign-in left the app.
//
// /oauth/consent is where claude.ai sends someone adding Conductor as a
// connector. If they are not signed in, password sign-in returns them through
// router state, but Google and Stitch sign-in leave the app and come back to
// "/", which loses the authorization_id. So the consent page parks its own URL
// here and RequireAuth sends the person back when it next sees a session. The
// consent page clears it on arrival (reading never clears, so a StrictMode
// double render cannot lose it). Same tab only, and only ever an /oauth/ path
// on this origin.

const KEY = "conductor.oauth-return";

export function rememberOAuthReturn(path: string): void {
  try {
    if (path.startsWith("/oauth/")) sessionStorage.setItem(KEY, path);
  } catch {
    // storage blocked: password sign-in still returns via router state
  }
}

export function peekOAuthReturn(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && v.startsWith("/oauth/") ? v : null;
  } catch {
    return null;
  }
}

export function clearOAuthReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
