// supabase/functions/_shared/helpers.ts
//
// Tiny boilerplate-killers shared by every edge function.

/**
 * Where a person ends up when they click a link we posted.
 *
 * ONE definition, because seven functions had their own copy of the string and
 * a domain move meant finding all seven. Conductor now lives on stitch.net.za,
 * the domain the agency's applications are collecting under; the old
 * convertedclick.co.za hostname stays live on the same Pages project and must
 * NOT be retired, because every client sign-off link already emailed and every
 * ClickUp comment ever posted by these functions points at it.
 *
 * Client sign-off links are not built from this — reviewUrlFor uses
 * window.location.origin, so a link minted on either host works from that host.
 * This constant is only for links WE post into ClickUp and staff email.
 *
 * A deploy of these functions is what makes a change here real. Do not point it
 * at a hostname before that hostname resolves, or every notification posted in
 * between carries a dead link.
 */
export const APP_URL = "https://conductor.stitch.net.za";

export function cors(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}
