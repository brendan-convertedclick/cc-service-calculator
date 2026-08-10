import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/utils";
import {
  useIssueRelayToken,
  useRelayTokenStatus,
  useRevokeRelayToken,
} from "@/hooks/useRelayTokens";

const RELAY_URL = `${(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/gmail-relay`;

export function SettingsConnectGmail() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const { data: status } = useRelayTokenStatus(email);
  const issue = useIssueRelayToken();
  const revoke = useRevokeRelayToken();
  const [justIssued, setJustIssued] = useState<string | null>(null);

  const generate = async () => {
    try {
      const result = await issue.mutateAsync();
      setJustIssued(result.token);
      toast.success("Token generated. Copy it now — it won't be shown again.");
    } catch (e) {
      toast.error(`Failed: ${errorMessage(e)}`);
    }
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Copied");
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ChevronLeft className="h-4 w-4" /> Settings</Link>
        </Button>
        <h1 className="text-headline-medium">Connect Gmail</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Generate your relay token</CardTitle>
          <CardDescription>
            One token per teammate. Shown once at generation. Regenerate any
            time — the previous token stops working immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-m-surface-container p-3">
            <div>
              <div className="text-label-large">{email ?? "Not signed in"}</div>
              <div className="text-label-small text-m-on-surface-variant">
                {status?.exists
                  ? `Token issued ${status.created_at ? new Date(status.created_at).toLocaleString("en-ZA") : ""}`
                  : "No active token"}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={generate} disabled={issue.isPending}>
                <RotateCw className="h-4 w-4" />
                {status?.exists ? "Regenerate" : "Generate token"}
              </Button>
              {status?.exists && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!email) return;
                    setJustIssued(null);
                    revoke.mutate(email);
                  }}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              )}
            </div>
          </div>

          {justIssued && (
            <div className="rounded-lg border border-m-error bg-m-error-container p-3 space-y-2">
              <div className="text-label-large text-m-on-error-container">
                Copy now — won't be shown again
              </div>
              <div className="flex items-center gap-2">
                <pre className="flex-1 truncate rounded-sm bg-m-surface p-2 text-body-small">
                  {justIssued}
                </pre>
                <Button size="sm" onClick={() => copy(justIssued)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Apps Script setup</CardTitle>
          <CardDescription>
            One-time, ~5 minutes. Full instructions in the repo at <code>apps-script/README.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-body-medium">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open <a className="underline" href="https://script.google.com/create" target="_blank" rel="noreferrer">script.google.com/create</a>.</li>
            <li>Paste the contents of <code>apps-script/inbox-relay.gs</code> into the editor.</li>
            <li>
              Project Settings → Script Properties — add three properties:
              <pre className="mt-2 rounded-sm bg-m-surface-container p-2 text-body-small">
{`RELAY_URL    = ${RELAY_URL}
RELAY_USER   = ${email ?? "<your email>"}
RELAY_SECRET = <token from step 1>`}
              </pre>
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => copy(RELAY_URL)}>
                <Copy className="h-4 w-4" /> Copy RELAY_URL
              </Button>
            </li>
            <li>Run <code>setup()</code> once — authorise Gmail scopes when prompted.</li>
            <li>Label any thread <code>→Inbox/Push</code> to test. Sent threads use <code>→Inbox/Push-Sent</code>.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
