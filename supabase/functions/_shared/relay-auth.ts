// Request validation for gmail-relay. Split out from index.ts so it can be
// imported by tests (importing index.ts would side-effect a Deno.serve socket
// bind at module load time).

import { hmacVerify } from "./hmac.ts";

export type ValidationResult =
  | { ok: true; userEmail: string; status?: never; error?: never }
  | { ok: false; status: number; error: string; userEmail?: never };

/** Minimal structural shape of a Supabase client needed by validateRequestProd. */
interface RelaySecretsClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: { secret: unknown; revoked_at: unknown } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Header + signature check. `lookupSecret(email)` returns the plaintext relay
 * token from relay_secrets, or null if the user has no row or the row is
 * revoked. Pulled out as a parameter so tests can stub the DB lookup.
 */
export async function validateRequest(
  req: Request,
  rawBody: string,
  lookupSecret: (email: string) => Promise<string | null>,
): Promise<ValidationResult> {
  const userEmail = req.headers.get("x-relay-user");
  const sig = req.headers.get("x-relay-signature");
  if (!userEmail || !sig) {
    return { ok: false, status: 401, error: "Missing relay headers" };
  }
  const secret = await lookupSecret(userEmail);
  if (!secret) {
    return { ok: false, status: 401, error: "Unknown or revoked user" };
  }
  const ok = await hmacVerify(rawBody, sig, secret);
  if (!ok) return { ok: false, status: 401, error: "Bad signature" };
  return { ok: true, userEmail };
}

/** Production wrapper: pulls the plaintext secret from relay_secrets.
 *  Surfaces DB failures as 503 (vs. the 401 used for missing/revoked rows)
 *  so an outage is diagnosable in function logs. */
export async function validateRequestProd(
  req: Request,
  rawBody: string,
  supabase: RelaySecretsClient,
): Promise<ValidationResult> {
  const userEmail = req.headers.get("x-relay-user");
  const sig = req.headers.get("x-relay-signature");
  if (!userEmail || !sig) {
    return { ok: false, status: 401, error: "Missing relay headers" };
  }

  const { data: row, error } = await supabase
    .from("relay_secrets")
    .select("secret, revoked_at")
    .eq("user_email", userEmail)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 503, error: `relay_secrets lookup failed: ${error.message}` };
  }

  const secret = !row || row.revoked_at ? null : (row.secret as string);
  return validateRequest(req, rawBody, async () => secret);
}
