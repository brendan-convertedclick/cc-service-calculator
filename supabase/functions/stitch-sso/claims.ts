// The id_token comes straight from Stitch's token endpoint over TLS, so its
// claims are checked rather than its signature (OIDC Core 3.1.3.7).

function claims(idToken: string): Record<string, unknown> | null {
  try {
    // UTF-8, so names like "Zoë" survive (atob alone gives Latin-1).
    const bin = atob((idToken.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** The Conductor auth user id Stitch recorded for this person, or null if the token isn't for Conductor, is stale, or they aren't set up. */
export function externalIdOf(idToken: string, issuer: string, now = Date.now() / 1000): string | null {
  const c = claims(idToken);
  if (!c) return null;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== issuer || !aud.includes("conductor") || !((c.exp as number) > now)) return null;
  return typeof c.external_id === "string" && c.external_id ? c.external_id : null;
}

/** The person's name as Stitch has it (Stitch owns identity), or null. */
export function nameOf(idToken: string): string | null {
  const v = claims(idToken)?.name;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
