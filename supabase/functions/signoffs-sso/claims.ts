// The id_token comes straight from Stitch's token endpoint over TLS, so its
// claims are checked rather than its signature (OIDC Core 3.1.3.7).
// Copied from stitch-sso/claims.ts on purpose: functions don't import across folders.

function claims(idToken: string): Record<string, unknown> | null {
  try {
    // UTF-8, so names like "Zoë" survive (atob alone gives Latin-1).
    const bin = atob((idToken.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Who Stitch says is signing in to Sign-offs: the Conductor client (org_ref) and
 * contact (external_id) it recorded, plus the email as a fallback key. Null if the
 * token isn't for `signoffs` (a staff `conductor` token is refused here), is stale,
 * or any of the three is missing.
 */
export function signoffsClaimsOf(
  idToken: string,
  issuer: string,
  now = Date.now() / 1000,
): { clientId: string; contactId: string; email: string } | null {
  const c = claims(idToken);
  if (!c) return null;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== issuer || !aud.includes("signoffs") || typeof c.exp !== "number" || !(c.exp > now)) return null;
  const clientId = str(c.org_ref), contactId = str(c.external_id), email = str(c.email);
  return clientId && contactId && email ? { clientId, contactId, email } : null;
}
