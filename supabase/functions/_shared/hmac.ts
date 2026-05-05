// HMAC-SHA256 hex signing/validation for the gmail-relay endpoint.
// Apps Script sends:
//   x-relay-user:      teammate email
//   x-relay-signature: hex(hmac_sha256(rawBody, secret))
// We look up relay_secrets by user_email and HMAC-verify the body against
// the stored plaintext secret. See plan note for the plaintext-storage call.

const enc = new TextEncoder();

export async function hmacSign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function hmacVerify(
  body: string,
  candidateHex: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSign(body, secret);
  return timingSafeEqualHex(expected, candidateHex);
}

/** Generate a 32-byte URL-safe random token. Shown to the user once. */
export function newPlaintextToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, no padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
