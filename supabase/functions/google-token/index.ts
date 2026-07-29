// supabase/functions/google-token/index.ts
//
// Captures + reports the Google OAuth grant riding on the existing Supabase
// Auth Google sign-in (see AuthContext.tsx) — there is NO separate
// google-oauth start/callback flow. Three actions, all authenticated via the
// caller's Supabase JWT (createUserClient(req).auth.getUser() → team_members
// row by email):
//
//   POST { action: "store", provider_refresh_token, provider_token?,
//          expires_in?, scope? }
//     → upsert google_user_tokens (service role) for the caller.
//       If provider_refresh_token is absent/empty, an existing stored
//       refresh_token is kept as-is (never nulled) → { ok: true, kept: true }.
//       Otherwise → { ok: true, google_email }.
//       provider_token/expires_in are accepted (matching AuthContext's request
//       shape) but deliberately NOT stored — see the comment above the store
//       handler for why persisting them here would go stale on page reload.
//       access_token/expires_at are owned by _shared/google-token.ts instead.
//
//   POST or GET { action: "status" }  (GET as ?action=status)
//     → { connected, google_email, scope, connected_at } for the caller.
//       Never returns a token.
//
//   POST { action: "disconnect" } → deletes the caller's row → { ok: true }.
//
// Deployed with --no-verify-jwt (this project's ES256 user tokens can't be
// validated by the gateway) — auth is entirely the createUserClient(req)
// check above, same posture as clickup-oauth.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient, createUserClient } from "../_shared/supabase-client.ts";

async function resolveCaller(
  req: Request,
): Promise<{ memberId: string; email: string } | { error: string }> {
  try {
    const userClient = createUserClient(req);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user?.email) {
      return { error: "Could not resolve the signed-in user." };
    }

    const svc = createServiceRoleClient();
    const { data: member, error: memberErr } = await svc
      .from("team_members")
      .select("id")
      .eq("email", userData.user.email)
      .maybeSingle();

    if (memberErr) return { error: memberErr.message };
    if (!member) return { error: `No team_members row for ${userData.user.email}.` };

    return { memberId: (member as { id: string }).id, email: userData.user.email };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error resolving caller." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  const url = new URL(req.url);
  let action = url.searchParams.get("action");
  let payload: Record<string, unknown> = {};
  if (req.method === "POST") {
    payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof payload.action === "string") action = payload.action;
  }

  // ── status ───────────────────────────────────────────────────────────────
  if (action === "status") {
    const caller = await resolveCaller(req);
    if ("error" in caller) {
      return json({ connected: false, google_email: null, scope: null, connected_at: null });
    }

    const svc = createServiceRoleClient();
    const { data: row } = await svc
      .from("google_user_tokens")
      .select("google_email, scope, connected_at")
      .eq("team_member_id", caller.memberId)
      .maybeSingle();

    const r = row as { google_email: string | null; scope: string | null; connected_at: string | null } | null;
    return json({
      connected: !!r,
      google_email: r?.google_email ?? null,
      scope: r?.scope ?? null,
      connected_at: r?.connected_at ?? null,
    });
  }

  // ── store ────────────────────────────────────────────────────────────────
  if (action === "store") {
    if (req.method !== "POST") return json({ error: "store requires POST" }, 405);

    const caller = await resolveCaller(req);
    if ("error" in caller) return json({ error: caller.error }, 401);

    const svc = createServiceRoleClient();

    const rawRefresh = payload.provider_refresh_token;
    const refreshToken = typeof rawRefresh === "string" ? rawRefresh.trim() : "";
    const scope = typeof payload.scope === "string" ? payload.scope : null;
    // Deliberately NOT persisting payload.provider_token/expires_in here: on a
    // page reload auth-js re-emits the ORIGINAL provider_token with a
    // fresh-looking expires_in (issuance lifetime, not remaining time), which
    // would overwrite a still-fresh row with an already-dead access_token.
    // access_token/expires_at are owned entirely by ensureFreshAccessToken in
    // _shared/google-token.ts, sourced from Google's own refresh response —
    // leaving them null here just means the first calendar call refreshes.

    const { data: existing } = await svc
      .from("google_user_tokens")
      .select("id")
      .eq("team_member_id", caller.memberId)
      .maybeSingle();

    if (!refreshToken) {
      // No refresh token on this payload (e.g. re-emitted from a restored
      // session, not a fresh OAuth consent) — never null out one we already
      // hold, just refresh whatever incidental fields did arrive.
      if (!existing) return json({ ok: true, kept: false });

      if (scope) {
        const { error: updErr } = await svc
          .from("google_user_tokens")
          .update({ google_email: caller.email, scope })
          .eq("team_member_id", caller.memberId);
        if (updErr) return json({ error: updErr.message }, 500);
      }
      return json({ ok: true, kept: true });
    }

    if (existing) {
      const { error: updErr } = await svc
        .from("google_user_tokens")
        .update({
          google_email: caller.email,
          refresh_token: refreshToken,
          scope,
        })
        .eq("team_member_id", caller.memberId);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, google_email: caller.email });
    }

    // Insert-only path (not upsert): connected_at is set once here and left
    // alone on every subsequent re-consent above, so "earliest-connected row"
    // (the operator fallback in _shared/google-token.ts) stays stable instead
    // of reshuffling every time someone re-logs-in with prompt=consent.
    const { error: insErr } = await svc.from("google_user_tokens").insert({
      team_member_id: caller.memberId,
      google_email: caller.email,
      access_token: null,
      refresh_token: refreshToken,
      expires_at: null,
      scope,
      connected_at: new Date().toISOString(),
    });
    if (insErr) return json({ error: insErr.message }, 500);
    return json({ ok: true, google_email: caller.email });
  }

  // ── disconnect ───────────────────────────────────────────────────────────
  if (action === "disconnect") {
    if (req.method !== "POST") return json({ error: "disconnect requires POST" }, 405);

    const caller = await resolveCaller(req);
    if ("error" in caller) return json({ error: caller.error }, 401);

    const svc = createServiceRoleClient();
    const { error } = await svc
      .from("google_user_tokens")
      .delete()
      .eq("team_member_id", caller.memberId);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action. Use: store, status, disconnect" }, 400);
});
