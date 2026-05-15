import { useState, useEffect } from "react";
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
import { Trash2 } from "lucide-react";
import {
  useTaskGroups,
  useUpsertTaskGroup,
  useArchiveTaskGroup,
  useTimeCategories,
  useUpsertTimeCategory,
  useArchiveTimeCategory,
} from "@/hooks/useOngoingTasks";
import type { TaskGroup, TaskTemplate } from "@/types/ongoing";

type SectionKey = "clickup" | "anthropic" | "xero" | "gmail" | "sow" | "productivity" | "output-multiplier" | "task-catalog";

const NAV: { key: SectionKey; label: string }[] = [
  { key: "clickup",          label: "ClickUp" },
  { key: "anthropic",        label: "Anthropic" },
  { key: "xero",             label: "Xero" },
  { key: "gmail",            label: "Gmail" },
  { key: "sow",              label: "SOW Clauses" },
  { key: "productivity",     label: "Productivity" },
  { key: "output-multiplier", label: "Output Multiplier" },
  { key: "task-catalog",     label: "Task catalog" },
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

  useEffect(() => {
    if (s) setGoalInput(String(s.productivity_goal_points ?? 40));
  }, [s?.productivity_goal_points]);

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
                <div className="space-y-2">
                  <Label htmlFor="cu-internal-list">Internal list ID</Label>
                  <Input
                    id="cu-internal-list"
                    defaultValue={s.clickup_internal_list_id ?? ""}
                    placeholder="901234567890"
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (s.clickup_internal_list_id ?? null)) {
                        update.mutate(
                          { clickup_internal_list_id: v },
                          { onSuccess: () => toast.success("Saved") },
                        );
                      }
                    }}
                  />
                  <p className="text-label-small text-m-on-surface-variant">
                    ClickUp list that hosts all perpetual ongoing tasks (Standup, Admin, etc.).
                    One list, every team member. Create it in ClickUp first, then paste the ID.
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

          {activeSection === "output-multiplier" && (
            <Card>
              <CardHeader>
                <CardTitle>Output Multiplier</CardTitle>
                <CardDescription>
                  Configure the blended rate used to calculate the equivalent human cost of passive agent output.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="blended-rate">Blended hourly rate (ZAR)</Label>
                  <Input
                    id="blended-rate"
                    type="number"
                    min={1}
                    max={9999}
                    defaultValue={s.blended_hourly_rate_zar}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 1 && v <= 9999) {
                        update.mutate(
                          { blended_hourly_rate_zar: v },
                          { onSuccess: () => toast.success("Saved") },
                        );
                      }
                    }}
                  />
                  <p className="text-label-small text-m-on-surface-variant">
                    Used to calculate the equivalent human cost of passive agent output.
                  </p>
                </div>
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

          {activeSection === "task-catalog" && <TaskCatalogCard />}

        </div>
      </div>
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function TaskCatalogCard() {
  const { data: groups = [] } = useTaskGroups();
  const { data: templates = [] } = useTimeCategories();

  const globalTemplates = templates.filter((t) => !t.is_custom);
  const customTemplates = templates.filter((t) => t.is_custom);

  return (
    <div className="space-y-4">
      <TaskGroupsCard groups={groups} />
      <Card>
        <CardHeader>
          <CardTitle>Global task catalog</CardTitle>
          <CardDescription>
            Reusable task templates available to every client. Provisioning a
            template creates a perpetual ClickUp task (member × client × template).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.map((g) => (
            <GroupTemplatesSection
              key={g.id}
              group={g}
              templates={globalTemplates.filter((t) => t.group_id === g.id)}
            />
          ))}
          {groups.length === 0 && (
            <div className="text-body-small text-m-on-surface-variant">
              Add a group above to start creating task templates.
            </div>
          )}
        </CardContent>
      </Card>

      {customTemplates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Custom (client-scoped) templates</CardTitle>
            <CardDescription>
              Templates created for a single client. Promote a custom template to
              the global catalog once it's broadly useful (coming soon).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {customTemplates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 text-body-small"
              >
                <span className="flex-1">{t.label}</span>
                <span className="text-m-on-surface-variant">
                  {groups.find((g) => g.id === t.group_id)?.label ?? "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TaskGroupsCard({ groups }: { groups: TaskGroup[] }) {
  const upsert = useUpsertTaskGroup();
  const archive = useArchiveTaskGroup();
  const [newLabel, setNewLabel] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task groups</CardTitle>
        <CardDescription>
          Top-level groupings that map 1:1 to a ClickUp List inside each
          client's Folder (e.g. Administration, Delivery, Meetings).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center gap-2">
            <Input
              defaultValue={g.label}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== g.label) upsert.mutate({ id: g.id, label: v });
              }}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (
                  confirm(
                    `Archive group "${g.label}"? Templates in it stay but won't show in pickers.`,
                  )
                ) {
                  archive.mutate(g.id);
                }
              }}
              aria-label={`Archive ${g.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New group (e.g. Strategy)"
            className="flex-1"
          />
          <Button
            onClick={() => {
              const label = newLabel.trim();
              if (!label) return;
              upsert.mutate(
                {
                  label,
                  label_key: slugify(label),
                  display_order: (groups[groups.length - 1]?.display_order ?? 0) + 10,
                },
                { onSuccess: () => setNewLabel("") },
              );
            }}
          >
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupTemplatesSection({
  group,
  templates,
}: {
  group: TaskGroup;
  templates: TaskTemplate[];
}) {
  const upsert = useUpsertTimeCategory();
  const archive = useArchiveTimeCategory();
  const [newLabel, setNewLabel] = useState("");

  return (
    <div className="space-y-2">
      <div className="text-title-small">{group.label}</div>
      {templates.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <Input
            defaultValue={t.label}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== t.label) upsert.mutate({ id: t.id, label: v });
            }}
            className="flex-1"
          />
          <Input
            type="number"
            step="0.25"
            defaultValue={t.weekly_budget_hours ?? ""}
            placeholder="hrs/wk"
            className="w-24"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const v = raw === "" ? null : Number(raw);
              if (v !== t.weekly_budget_hours) {
                upsert.mutate({ id: t.id, weekly_budget_hours: v });
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (
                confirm(
                  `Archive "${t.label}"? Existing tasks stay; no new tasks will be provisioned.`,
                )
              ) {
                archive.mutate(t.id);
              }
            }}
            aria-label={`Archive ${t.label}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={`New ${group.label.toLowerCase()} template`}
          className="flex-1"
        />
        <Button
          variant="outline"
          onClick={() => {
            const label = newLabel.trim();
            if (!label) return;
            upsert.mutate(
              {
                label,
                label_key: slugify(`${group.label_key}-${label}`),
                group_id: group.id,
                display_order: (templates[templates.length - 1]?.display_order ?? 0) + 10,
              },
              { onSuccess: () => setNewLabel("") },
            );
          }}
        >
          Add
        </Button>
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
