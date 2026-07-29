// supabase/functions/_shared/google-token.ts
//
// Resolve a live Google OAuth access token for calendar.events calls, from the
// refresh tokens captured off the existing Supabase Auth Google sign-in (see
// AuthContext.tsx + google-token/index.ts's "store" action — there is no
// separate google-oauth flow).
//
// Resolution order:
//   1. opts.googleEmail, if given — pins to ONE specific calendar account (used
//      by manage-internal-meeting's update/cancel so an edit lands on the same
//      calendar the meeting was created on). If that account has no grant, we
//      stop and report an error rather than falling through to a different
//      account and duplicating the event on a second calendar.
//   2. opts.memberId, if given — the meeting's organiser.
//   3. the JWT caller's own row.
//   4. the earliest-connected row — the de-facto "operator" account, so a
//      staff member who hasn't re-consented yet can still get a meeting
//      scheduled.
//
// Access tokens are refreshed whenever expired or within 60s of expiring, and
// the refreshed token + expiry are persisted back onto the row. A refresh that
// comes back invalid_grant (revoked by the user, or ~6 months idle) clears the
// stored row so the UI reports "disconnected" and prompts a re-login.
//
// Never throws — every failure degrades to { accessToken: null, error }.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (same values as
// Supabase Auth → Providers → Google, just not visible to edge functions).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createServiceRoleClient, createUserClient } from "./supabase-client.ts";

export interface GoogleAccessToken {
  accessToken: string | null;
  googleEmail: string | null;
  via: "member" | "operator" | "none";
  error?: string;
}

interface GoogleTokenRow {
  team_member_id: string;
  google_email: string | null;
  access_token: string | null;
  refresh_token: string;
  expires_at: string | null;
}

const ROW_COLUMNS = "team_member_id, google_email, access_token, refresh_token, expires_at";

async function resolveCallerMemberId(req: Request): Promise<string | null> {
  try {
    const userClient = createUserClient(req);
    const { data: userData, error } = await userClient.auth.getUser();
    if (error || !userData.user?.email) return null;
    const svc = createServiceRoleClient();
    const { data: member } = await svc
      .from("team_members")
      .select("id")
      .eq("email", userData.user.email)
      .maybeSingle();
    return (member as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

// Refresh the row's access token if it's missing, expired, or expiring within
// 60s. The stored expires_at is only approximate (it's derived from the
// Supabase session's expires_in at capture time, not a value Google returns
// directly to us at store time) — that's fine, it just means we may refresh a
// little earlier than strictly necessary, never later.
async function ensureFreshAccessToken(
  svc: SupabaseClient,
  row: GoogleTokenRow,
  via: "member" | "operator",
): Promise<GoogleAccessToken> {
  const now = Date.now();
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const needsRefresh = !row.access_token || !row.expires_at || expiresAtMs - now < 60_000;

  if (!needsRefresh) {
    return { accessToken: row.access_token, googleEmail: row.google_email, via };
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return {
      accessToken: row.access_token,
      googleEmail: row.google_email,
      via,
      error: row.access_token ? undefined : "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET not configured.",
    };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
      }),
    });

    const body = await res.json().catch(() => ({})) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!res.ok) {
      if (body.error === "invalid_grant") {
        await svc.from("google_user_tokens").delete().eq("team_member_id", row.team_member_id);
        return {
          accessToken: null,
          googleEmail: row.google_email,
          via,
          error: "Google access was revoked — sign in with Google again to reconnect.",
        };
      }
      return {
        accessToken: null,
        googleEmail: row.google_email,
        via,
        error: `Google token refresh failed: ${body.error ?? res.status}`,
      };
    }

    const accessToken = body.access_token ?? null;
    const expiresAt = body.expires_in ? new Date(now + body.expires_in * 1000).toISOString() : null;

    if (accessToken) {
      await svc
        .from("google_user_tokens")
        .update({ access_token: accessToken, expires_at: expiresAt })
        .eq("team_member_id", row.team_member_id);
    }

    return {
      accessToken,
      googleEmail: row.google_email,
      via,
      error: accessToken ? undefined : "Google did not return an access token.",
    };
  } catch (e) {
    return {
      accessToken: row.access_token,
      googleEmail: row.google_email,
      via,
      error: e instanceof Error ? e.message : "Failed to refresh Google access token.",
    };
  }
}

export async function getGoogleAccessToken(
  req: Request,
  opts?: { memberId?: string; googleEmail?: string },
): Promise<GoogleAccessToken> {
  try {
    const svc = createServiceRoleClient();

    if (opts?.googleEmail) {
      const { data: row } = await svc
        .from("google_user_tokens")
        .select(ROW_COLUMNS)
        .eq("google_email", opts.googleEmail)
        .limit(1)
        .maybeSingle();
      if (!row) {
        return {
          accessToken: null,
          googleEmail: opts.googleEmail,
          via: "none",
          error: `No Google account connected for ${opts.googleEmail}.`,
        };
      }
      return await ensureFreshAccessToken(svc, row as GoogleTokenRow, "member");
    }

    let row: GoogleTokenRow | null = null;

    if (opts?.memberId) {
      const { data } = await svc
        .from("google_user_tokens")
        .select(ROW_COLUMNS)
        .eq("team_member_id", opts.memberId)
        .maybeSingle();
      row = data as GoogleTokenRow | null;
    }

    if (!row) {
      const callerId = await resolveCallerMemberId(req);
      if (callerId) {
        const { data } = await svc
          .from("google_user_tokens")
          .select(ROW_COLUMNS)
          .eq("team_member_id", callerId)
          .maybeSingle();
        row = data as GoogleTokenRow | null;
      }
    }

    if (row) return await ensureFreshAccessToken(svc, row, "member");

    const { data: operatorRow } = await svc
      .from("google_user_tokens")
      .select(ROW_COLUMNS)
      .order("connected_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!operatorRow) {
      return {
        accessToken: null,
        googleEmail: null,
        via: "none",
        error: "No Google account connected — sign in with Google to grant calendar access.",
      };
    }

    return await ensureFreshAccessToken(svc, operatorRow as GoogleTokenRow, "operator");
  } catch (e) {
    return {
      accessToken: null,
      googleEmail: null,
      via: "none",
      error: e instanceof Error ? e.message : "Unknown error resolving Google credentials.",
    };
  }
}
