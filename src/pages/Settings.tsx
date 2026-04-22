import { useState } from "react";
import { toast } from "sonner";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

function mask(secret: string | null): string {
  if (!secret) return "";
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function Settings() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [clickupPat, setClickupPat] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");

  if (isLoading || !s) return <div className="p-6">Loading…</div>;

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-headline-medium">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>ClickUp</CardTitle>
          <CardDescription>
            Personal Access Token + workspace. Toggle fires pushes on acceptance.
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
          <div className="space-y-2">
            <Label htmlFor="cu-pat">Personal Access Token</Label>
            <Input
              id="cu-pat"
              type="password"
              placeholder={s.clickup_pat ? mask(s.clickup_pat) : "pk_…"}
              value={clickupPat}
              onChange={(e) => setClickupPat(e.target.value)}
            />
          </div>
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
                {
                  clickup_pat: clickupPat || s.clickup_pat,
                  clickup_workspace_id: workspaceId || s.clickup_workspace_id,
                },
                {
                  onSuccess: () => {
                    toast.success("Saved");
                    setClickupPat("");
                    setWorkspaceId("");
                  },
                },
              )
            }
          >
            Save ClickUp
          </Button>
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
          <CardTitle>Burn sync</CardTitle>
          <CardDescription>
            Cadence applies to the next scheduled run of sync-clickup-actuals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Cadence</Label>
            <Select
              value={String(s.burn_sync_cron_minutes)}
              onValueChange={(v) =>
                update.mutate(
                  { burn_sync_cron_minutes: Number(v) },
                  { onSuccess: () => toast.success("Saved") },
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Every 15 minutes</SelectItem>
                <SelectItem value="30">Every 30 minutes</SelectItem>
                <SelectItem value="60">Every hour</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Xero card omitted: Phase 1 hides the card entirely (spec §7.6). Added in Phase 2. */}
    </div>
  );
}
