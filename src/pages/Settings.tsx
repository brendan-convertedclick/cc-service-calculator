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

export function Settings() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [workspaceId, setWorkspaceId] = useState("");

  if (isLoading || !s) return <div className="p-6">Loading…</div>;

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

      {/* Xero card omitted: Phase 1 hides the card entirely (spec §7.6). Added in Phase 2. */}
    </div>
  );
}
