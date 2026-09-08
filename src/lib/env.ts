const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * True only for actual local dev. This must be a POSITIVE test for localhost,
 * never "not the prod hostname": the cloudflared tunnel now fronts the dev
 * server at conductor-dev.convertedclick.co.za, which is a public URL where
 * `import.meta.env.DEV` is true. Anything less strict auto-logs the whole
 * internet in as the shared team@ owner account.
 */
export function isLocalDev(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    LOCAL_HOSTNAMES.includes(window.location.hostname)
  );
}

/**
 * The one address a client-facing link may carry.
 *
 * It must MATCH `APP_URL` in supabase/functions/_shared/helpers.ts, which is
 * what the edge functions put in their emails and ClickUp comments. Change one,
 * change both. A test in client-links.test.ts asserts they have not drifted.
 *
 * This is not `window.location.origin`, and that is the whole point. The dev
 * tunnel at conductor-dev.convertedclick.co.za is a public URL, so a link built
 * from the origin while working there went out to a client pointing at a
 * laptop, and stopped resolving the moment the dev server did. The old address
 * conductor.convertedclick.co.za still serves the same app for every link
 * already sent, so nothing minted before this breaks.
 */
export const APP_URL = "https://conductor.stitch.net.za";

/**
 * Where a link handed to a client should point. Always production, except on
 * an actual localhost, where a prod link would be untestable and a localhost
 * link can reach nobody anyway.
 */
export function clientLinkOrigin(): string {
  return isLocalDev() ? window.location.origin : APP_URL;
}
