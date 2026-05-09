import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useClickUpSpaces } from "@/hooks/useClients";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function Settings() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  if (isLoading || !s) return <div className="p-6">Loading…</div>;

  const xeroConnectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-oauth?action=connect`;

  const handleXeroDisconnect = async () => {
    setDisconnecting(true);
    try {
      // xero-oauth?action=disconnect uses GET-style query param but we POST
      // so the edge function's OPTIONS + method guard is satisfied.
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-oauth?action=disconnect`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error ?? "Disconnect failed");
      }
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Xero disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-headline-medium">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>ClickUp</CardTitle>
          <CardDescription>
            Workspace + enable toggle. Toggle fires pushes on acceptance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="cu-enabled">Enabled</Label>
            <Switch
              id="cu-enabled"
              checked={s.clickup_enabled}
              onCheckedChange={(v) =>
                update.mutate(
                  { clickup_enabled: v },
                  { onSuccess: () => toast.success("Saved") },
                )
              }
            />
          </div>
          <p className="text-label-small text-m-on-surface-variant">
            PAT is stored as the CLICKUP_PAT Supabase Edge Function secret. Update it in the project dashboard, not here.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cu-ws">Workspace ID</Label>
            <Input
              id="cu-ws"
              placeholder={s.clickup_workspace_id ?? "9008…"}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() =>
              update.mutate(
                { clickup_workspace_id: workspaceId || s.clickup_workspace_id },
                {
                  onSuccess: () => {
                    toast.success("Saved");
                    setWorkspaceId("");
                  },
                },
              )
            }
          >
            Save workspace ID
          </Button>
          <div className="space-y-2">
            <Label htmlFor="cu-clients-space">Clients space</Label>
            <ClickUpSpaceSelect
              value={s.clickup_clients_space_id ?? ""}
              onChange={(v) =>
                update.mutate(
                  { clickup_clients_space_id: v || null },
                  { onSuccess: () => toast.success("Saved") },
                )
              }
            />
            <p className="text-label-small text-m-on-surface-variant">
              The ClickUp top-level space that holds your client folders. Required before you can link clients to folders.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anthropic</CardTitle>
          <CardDescription>
            Model for draft-scope, suggest-services, draft-sow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="anth-enabled">Enabled</Label>
            <Switch
              id="anth-enabled"
              checked={s.anthropic_enabled}
              onCheckedChange={(v) =>
                update.mutate(
                  { anthropic_enabled: v },
                  { onSuccess: () => toast.success("Saved") },
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Select
              value={s.anthropic_model}
              onValueChange={(v) =>
                update.mutate(
                  { anthropic_model: v },
                  { onSuccess: () => toast.success("Saved") },
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
                <SelectItem value="claude-opus-4-7">claude-opus-4-7</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Xero</CardTitle>
          <CardDescription>
            Connect Xero to push quotes directly from the Quote Send page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {s.xero_enabled && s.xero_oauth_tokens ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-label-small font-medium text-green-800">
                  Connected
                </span>
                {(s.xero_oauth_tokens as { xero_userid?: string; preferred_username?: string })
                  ?.preferred_username && (
                  <span className="text-body-small text-m-on-surface-variant">
                    {(s.xero_oauth_tokens as { preferred_username: string }).preferred_username}
                  </span>
                )}
              </div>
              <p className="text-label-small text-m-on-surface-variant">
                OAuth tokens are stored securely. Client credentials (XERO_CLIENT_ID,
                XERO_CLIENT_SECRET) must be set as Supabase Edge Function secrets.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleXeroDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect Xero"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-label-small text-m-on-surface-variant">
                Not connected. Clicking below will redirect you to Xero to authorise access.
                Ensure XERO_CLIENT_ID and XERO_CLIENT_SECRET are set as Supabase Edge Function
                secrets before connecting.
              </p>
              <Button asChild size="sm">
                <a href={xeroConnectUrl}>Connect Xero</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gmail intake</CardTitle>
          <CardDescription>
            Pipe labelled Gmail threads into the shared Inbox. One-time per-teammate setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/settings/gmail">Connect Gmail →</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ClickUpSpaceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: spaces, isLoading, error } = useClickUpSpaces();
  if (isLoading) {
    return <div className="text-body-small text-m-on-surface-variant">Loading spaces...</div>;
  }
  if (error) {
    return (
      <div className="text-body-small text-destructive">
        Couldn't load spaces: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  const options = (spaces ?? []).map((s) => ({ value: s.id, label: s.name }));
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Select a space..."
      emptyLabel="No spaces in this workspace."
    />
  );
}
