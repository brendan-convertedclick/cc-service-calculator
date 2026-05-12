import { useState } from "react";
import { SOWLevelsManager } from "@/components/sow/SOWLevelsManager";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useClickUpSpaces } from "@/hooks/useClients";
import { useXeroConnectionStatus } from "@/hooks/useClientMargin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type SectionKey = "clickup" | "anthropic" | "xero" | "gmail" | "sow" | "productivity";

const NAV: { key: SectionKey; label: string }[] = [
  { key: "clickup",      label: "ClickUp" },
  { key: "anthropic",    label: "Anthropic" },
  { key: "xero",         label: "Xero" },
  { key: "gmail",        label: "Gmail" },
  { key: "sow",          label: "SOW Clauses" },
  { key: "productivity", label: "Productivity" },
];

export function Settings() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [workspaceId, setWorkspaceId] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("clickup");
  const [goalInput, setGoalInput] = useState(
    String(s?.productivity_goal_points ?? 40)
  );
  const xeroStatus = useXeroConnectionStatus();

  const xeroParam = searchParams.get("xero");
  if (xeroParam === "connected") {
    toast.success("Xero connected successfully!");
  }

  if (isLoading || !s) return <div className="p-6">Loading…</div>;

  const xeroConnectUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-oauth?action=start`;

  const handleXeroSync = async () => {
    setSyncing(true);
    try {
      const { data: sessionData } = await (await import("@/lib/supabase")).supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      const body = await res.json() as { synced?: number; message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      toast.success(body.message ?? `Synced ${body.synced} invoice(s)`);
      await qc.invalidateQueries({ queryKey: ["xeroConnectionStatus"] });
      await qc.invalidateQueries({ queryKey: ["xeroHasInvoices"] });
      await qc.invalidateQueries({ queryKey: ["clientMargin"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleXeroDisconnect = async () => {
    setDisconnecting(true);
    try {
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
    <div className="container mx-auto max-w-5xl p-8">
      <h1 className="text-headline-medium text-m-on-surface">Settings</h1>
      <p className="mt-1 text-body-medium text-m-on-surface-variant">
        Configure integrations and workspace preferences.
      </p>

      <div className="mt-6 flex gap-6">
        {/* Left nav */}
        <div className="w-44 shrink-0 space-y-0.5 sticky top-0 self-start">
          {NAV.map(({ key, label }) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveSection(key)}
              className={`flex w-full items-center gap-2.5 rounded-full px-4 py-2.5 text-left text-label-large transition-colors ${
                key === activeSection
                  ? "bg-m-primary-container font-semibold text-m-on-primary-container"
                  : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0">

          {activeSection === "clickup" && (
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
          )}

          {activeSection === "anthropic" && (
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
          )}

          {activeSection === "xero" && (
            <Card>
              <CardHeader>
                <CardTitle>Xero</CardTitle>
                <CardDescription>
                  Connect Xero to push quotes and sync invoices for margin tracking.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(s.xero_enabled && s.xero_oauth_tokens) || xeroStatus.data?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-label-small font-medium text-green-800">
                        Connected
                      </span>
                      {xeroStatus.data?.tenantName && (
                        <span className="text-body-small text-m-on-surface-variant">
                          {xeroStatus.data.tenantName}
                        </span>
                      )}
                      {!xeroStatus.data?.tenantName &&
                        (s.xero_oauth_tokens as { preferred_username?: string } | null)
                          ?.preferred_username && (
                          <span className="text-body-small text-m-on-surface-variant">
                            {(s.xero_oauth_tokens as { preferred_username: string }).preferred_username}
                          </span>
                        )}
                    </div>
                    {xeroStatus.data?.lastSyncedAt && (
                      <p className="text-label-small text-m-on-surface-variant">
                        Last synced:{" "}
                        {new Date(xeroStatus.data.lastSyncedAt).toLocaleString("en-ZA", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    )}
                    <p className="text-label-small text-m-on-surface-variant">
                      OAuth tokens are stored securely. Client credentials (XERO_CLIENT_ID,
                      XERO_CLIENT_SECRET) must be set as Supabase Edge Function secrets.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleXeroSync} disabled={syncing}>
                        {syncing ? "Syncing…" : "Sync invoices"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleXeroDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? "Disconnecting…" : "Disconnect Xero"}
                      </Button>
                    </div>
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
          )}

          {activeSection === "gmail" && (
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
          )}

          {activeSection === "sow" && (
            <Card>
              <CardHeader>
                <CardTitle>SOW Clause Hierarchy</CardTitle>
                <CardDescription>
                  Define the priority order for scope-of-work clause inheritance. Higher levels override lower ones.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SOWLevelsManager />
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs text-muted-foreground mb-2">Edit clause values per service family:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "paid-media-management",
                      "creative-production",
                      "website-build",
                      "seo-content",
                      "website-hosting-maintenance",
                      "social-media-management",
                      "analytics-tracking",
                      "video-3d-production",
                      "marketing-automation",
                    ].map(slug => (
                      <Link
                        key={slug}
                        to={`/sow/${slug}`}
                        className="text-xs text-indigo-400 underline hover:text-indigo-300 transition-colors"
                      >
                        {slug}
                      </Link>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "productivity" && (
            <Card>
              <CardHeader>
                <CardTitle>Productivity</CardTitle>
                <CardDescription>
                  Team-wide sprint point targets shown on the Productivity page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="prod-goal">Daily sprint point goal (team total)</Label>
                  <Input
                    id="prod-goal"
                    type="number"
                    min={1}
                    max={999}
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                  />
                  <p className="text-label-small text-m-on-surface-variant">
                    A dashed goal line appears on the sprint points chart at this value.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const parsed = parseInt(goalInput, 10);
                    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) {
                      toast.error("Goal must be between 1 and 999");
                      return;
                    }
                    update.mutate(
                      { productivity_goal_points: parsed },
                      { onSuccess: () => toast.success("Saved") },
                    );
                  }}
                >
                  Save goal
                </Button>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
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
