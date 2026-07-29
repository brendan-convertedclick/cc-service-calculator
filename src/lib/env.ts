const PROD_HOSTNAME = "conductor.convertedclick.co.za";

/**
 * True only for actual local dev. Prod is also served via `npm run dev` (no
 * build step), so `import.meta.env.DEV` is true there too — must also check
 * the hostname or every auth gate is bypassed in prod.
 */
export function isLocalDev(): boolean {
  return (
    import.meta.env.DEV &&
    (typeof window === "undefined" || !window.location.hostname.includes(PROD_HOSTNAME))
  );
}
