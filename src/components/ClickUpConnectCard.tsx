import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Per-user ClickUp OAuth connect/disconnect card. Self-contained so it can be
 * dropped on any page — used on /settings (admin/owner) and /staff (everyone
 * else, who can't reach /settings). Without this, a team member's actions
 * (chat posts, task assignment) attribute to whoever owns the shared
 * CLICKUP_PAT instead of to them.
 */
export function ClickUpConnectCard() {
  const [conn, setConn] = useState<{ connected: boolean; clickup_username: string | null } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        const res = await fetch(`${FUNCTIONS_BASE}/clickup-oauth?action=status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as { connected: boolean; clickup_username: string | null };
        if (!cancelled) setConn(body);
      } catch {
        if (!cancelled) setConn({ connected: false, clickup_username: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("clickup") === "connected") {
      toast.success("ClickUp connected successfully!");
    }
  }, []);

  // `?action=start` needs the caller's JWT, but a plain redirect can't send an
  // Authorization header — pass the JWT as a query param and navigate the
  // whole window, which 302s on to ClickUp's authorize page.
  const handleConnect = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    window.location.href = `${FUNCTIONS_BASE}/clickup-oauth?action=start&jwt=${encodeURIComponent(token)}`;
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch(`${FUNCTIONS_BASE}/clickup-oauth?action=disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error ?? "Disconnect failed");
      }
      setConn({ connected: false, clickup_username: null });
      toast.success("ClickUp disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ClickUp account</CardTitle>
        <CardDescription>
          Connect your own ClickUp account so tasks and chat messages you create are attributed to you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conn === null ? (
          <p className="text-label-small text-m-on-surface-variant">Checking…</p>
        ) : conn.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-label-small font-medium text-green-800">
                Connected
              </span>
              {conn.clickup_username && (
                <span className="text-body-small text-m-on-surface-variant">{conn.clickup_username}</span>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect ClickUp"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-label-small text-m-on-surface-variant">
              Not connected. Clicking below will redirect you to ClickUp to authorise access.
            </p>
            <Button size="sm" onClick={handleConnect}>
              Connect ClickUp
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
