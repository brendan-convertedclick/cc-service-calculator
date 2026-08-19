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
