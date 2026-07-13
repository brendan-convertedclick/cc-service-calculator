// supabase/functions/_shared/clickup-chat.ts
//
// Best-effort ClickUp Chat helpers. Used to notify a client's ClickUp Chat
// channel (and ping the task assignee) when a brief is briefed — from both
// the manual quick-brief path (create-quick-brief-task) and the scoped push
// path (push-to-clickup).
//
// API: ClickUp Public API v3 chat messages.
//   POST https://api.clickup.com/api/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/messages
//   Body: { type: "message", content: "...", content_format: "text/md" }
//   Auth: Authorization: <CLICKUP_PAT>
// (Confirmed via context7 /openapi/developer_clickup_openapi_clickup_public_api_v3_yaml.)
//
// Mentions: the v3 OpenAPI spec exposes no dedicated "mentions" request field —
// only `assignee`/`group_assignee` (which *assign* a message) and a read-only
// `tagged_users` link on the response. ClickUp's markdown chat content does
// parse inline `@email` / `@username` mentions and resolve them to tagged
// users (documented by the community ClickUp MCP server, taazkareem/clickup-
// mcp-server: "@Mentions with automatic user resolution"). So we embed the
// mention inline in `content` as `@{email}` when we have the assignee's email.
// This is best-effort: if ClickUp fails to resolve the token it degrades to
// visible text rather than a guaranteed push notification.

// Converted Click's ClickUp workspace/team id (see CLAUDE.md).
export const CLICKUP_WORKSPACE_ID = "37345392";

export type PostChatResult = { ok: boolean; status?: number; error?: string; message_id?: string };

/**
 * POST a message to a ClickUp Chat channel. NEVER throws — every failure path
 * returns `{ ok: false, ... }` so callers can log-and-continue.
 */
export async function postChatMessage(
  pat: string,
  channelId: string,
  content: string,
  workspaceId: string = CLICKUP_WORKSPACE_ID,
): Promise<PostChatResult> {
  try {
    if (!pat) return { ok: false, error: "missing CLICKUP_PAT" };
    if (!channelId) return { ok: false, error: "missing channelId" };
    if (!content) return { ok: false, error: "empty content" };

    const res = await fetch(
      `https://api.clickup.com/api/v3/workspaces/${workspaceId}/chat/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: { Authorization: pat, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "message",
          content,
          content_format: "text/md",
        }),
      },
    );

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        // ignore body read failure
      }
      return { ok: false, status: res.status, error: body || `HTTP ${res.status}` };
    }

    let message_id: string | undefined;
    try {
      const parsed = (await res.json()) as { id?: string };
      message_id = parsed?.id;
    } catch {
      // ignore parse failure — the POST succeeded, that's what matters
    }
    return { ok: true, status: res.status, message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Build the confirmed "brief briefed" chat message.
 *
 *   🆕 {mention} — new task briefed: {taskName} · {points} pt · {taskUrl}
 *
 * `mention` should already be the ping token (e.g. `@person@client.com`) or a
 * plain name / "team" when no assignee is known — callers decide via
 * mentionToken().
 */
export function briefBriefedMessage(
  { mention, taskName, points, taskUrl }: {
    mention: string;
    taskName: string;
    points: number | null | undefined;
    taskUrl: string;
  },
): string {
  const pts = points == null ? "?" : String(points);
  return `🆕 ${mention} — new task briefed: ${taskName} · ${pts} pt · ${taskUrl}`;
}

/**
 * Produce the best available mention token for a person. Prefers an inline
 * `@email` mention (ClickUp resolves these to a real ping), falls back to the
 * plain name, then to "team".
 */
export function mentionToken(
  { email, name }: { email?: string | null; name?: string | null },
): string {
  if (email && email.trim()) return `@${email.trim()}`;
  if (name && name.trim()) return name.trim();
  return "team";
}
