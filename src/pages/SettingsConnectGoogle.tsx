import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

type GoogleStatus = {
  connected: boolean;
  google_email: string | null;
  scope: string | null;
  connected_at: string | null;
};

// Status + reconnect only — the actual OAuth grant happens through the existing
// Supabase Auth Google sign-in (see AuthContext.signInWithGoogle). This page
// never starts or completes an OAuth flow of its own.
export function SettingsConnectGoogle() {
  const { signInWithGoogle } = useAuth();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = async () => {
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-token?action=status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = (await res.json()) as GoogleStatus;
      setStatus(body);
    } catch {
      setStatus({ connected: false, google_email: null, scope: null, connected_at: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-token?action=disconnect`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error ?? "Disconnect failed");
      }
      toast.success("Google Calendar disconnected");
      await loadStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ChevronLeft className="h-4 w-4" /> Settings</Link>
        </Button>
        <h1 className="text-headline-medium">Connect Google Calendar</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calendar access</CardTitle>
          <CardDescription>
            Signing in with Google grants Conductor permission to create calendar
            events (with a Meet link) for internal meetings you organise, so they
            land on every attendee's calendar. If you signed in before this
            feature shipped, sign out and sign in with Google again to grant it —
            the extra consent screen only appears once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-body-small text-m-on-surface-variant">Checking status…</div>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-label-small font-medium text-green-800">
                  Connected
                </span>
                {status.google_email && (
                  <span className="text-body-small text-m-on-surface-variant">
                    {status.google_email}
                  </span>
                )}
              </div>
              {status.connected_at && (
                <p className="text-label-small text-m-on-surface-variant">
                  Connected {new Date(status.connected_at).toLocaleString("en-ZA")}
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect Google Calendar"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-label-small text-m-on-surface-variant">
                Not connected. Meetings you organise will fall back to another
                connected teammate's calendar (or skip the Google Calendar step
                entirely) until you connect your own account.
              </p>
              <Button size="sm" onClick={() => signInWithGoogle()}>
                Sign in with Google
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
