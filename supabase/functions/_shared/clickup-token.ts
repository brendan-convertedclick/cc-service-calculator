// supabase/functions/_shared/clickup-token.ts
//
// Phase 2 of per-user ClickUp attribution (#5): resolve the ClickUp API
// token to use for a write, preferring the operator's own OAuth token
// (from clickup_user_tokens, set up in Phase 1 via clickup-oauth) and
// falling back to the shared CLICKUP_PAT secret.
//
// Never throws — any failure to identify the caller or find their token
// silently falls back to the shared PAT so callers can treat this as a
// drop-in replacement for `Deno.env.get("CLICKUP_PAT")`.

import { createServiceRoleClient, createUserClient } from "./supabase-client.ts";

export interface OperatorClickupToken {
  token: string;
  via: "user" | "shared";
  clickupUserId: number | null;
}

export async function getOperatorClickupToken(
  req: Request,
): Promise<OperatorClickupToken> {
  const shared = (): OperatorClickupToken => ({
    token: Deno.env.get("CLICKUP_PAT") ?? "",
    via: "shared",
    clickupUserId: null,
  });

  try {
    const userClient = createUserClient(req);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user?.email) return shared();

    const svc = createServiceRoleClient();
    const { data: member, error: memberErr } = await svc
      .from("team_members")
      .select("id")
      .eq("email", userData.user.email)
      .maybeSingle();
    if (memberErr || !member) return shared();

    const { data: tokenRow, error: tokenErr } = await svc
      .from("clickup_user_tokens")
      .select("access_token, clickup_user_id")
      .eq("team_member_id", (member as { id: string }).id)
      .maybeSingle();
    if (tokenErr || !tokenRow) return shared();

    const row = tokenRow as {
      access_token: string | null;
      clickup_user_id: string | null;
    };
    if (!row.access_token) return shared();

    const clickupUserId = row.clickup_user_id != null
      ? Number(row.clickup_user_id)
      : null;

    return {
      token: row.access_token,
      via: "user",
      clickupUserId: Number.isFinite(clickupUserId) ? clickupUserId : null,
    };
  } catch {
    return shared();
  }
}
