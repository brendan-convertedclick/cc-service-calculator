import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Pencil, RefreshCw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BurnChart } from "@/components/BurnChart";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectCommunications } from "@/components/projects/ProjectCommunications";
import { RetainerServicesEditor } from "@/components/retainers/RetainerServicesEditor";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { computeProjectProgress } from "@/lib/project-status";
import { useDepartments } from "@/hooks/useDepartments";
import { currentMonthKey, filterBurnActuals, monthRange } from "@/hooks/usePulseRetainerBurn";
import type { Database } from "@/types/db";
import type { ClaudePrompt } from "@/types/claude";

type RecurrenceInterval = Database["public"]["Enums"]["recurrence_interval"];

function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      return data as { inserted?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Synced — ${data?.inserted ?? 0} rows updated`);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { data } = useProject(id);
  const { data: depts = [] } = useDepartments();
  const sync = useSyncNow();
  const updateProject = useUpdateProject();

  const [recur, setRecur] = useState({
    is_recurring: false,
    recurrence_interval: null as RecurrenceInterval | null,
    recurrence_start: "",
    recurrence_end: "",
  });

  const [remoteDraft, setRemoteDraft] = useState("");
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    if (data?.project) {
      setRecur({
        is_recurring: data.project.is_recurring,
        recurrence_interval: data.project.recurrence_interval,
        recurrence_start: data.project.recurrence_start ?? "",
        recurrence_end: data.project.recurrence_end ?? "",
      });
      setRemoteDraft(data.project.git_remote_url ?? "");
      setNameDraft(data.project.name ?? "");
      setNameEditing(false);
      // due_date is a timestamptz — strip to YYYY-MM-DD for <input type="date">
      setDueDateDraft(
        data.project.due_date ? data.project.due_date.slice(0, 10) : "",
      );
    }
  }, [data?.project?.id]);

  const rows = useMemo(() => {
    if (!data) return [];
    const byDept = new Map<string, { planned: number; actual: number }>();
    for (const a of data.actuals) {
      const key = a.dept_id ?? "unknown";
      const cur = byDept.get(key) ?? { planned: 0, actual: 0 };
      cur.planned += Number(a.planned_hours);
      cur.actual += Number(a.actual_hours);
      byDept.set(key, cur);
    }
    return Array.from(byDept.entries()).map(([dept_id, v]) => ({
      dept_id,
      dept_name: depts.find((d) => d.id === dept_id)?.name ?? "No department",
      planned: v.planned,
      actual: v.actual,
    }));
  }, [data, depts]);

  if (!data) return <div className="p-6">Loading…</div>;
  const { project, actuals } = data;

  const totalPlanned = rows.reduce((a, r) => a + r.planned, 0);
  const totalActual = rows.reduce((a, r) => a + r.actual, 0);

  // Overall completion — same computation the Projects list uses for its ring,
  // shown here as a linear bar once a project is opened.
  const progress = computeProjectProgress(actuals);
  const progressPct = Math.round(progress.taskPct * 100);
  const hoursPct = Math.round(progress.timePct * 100);

  const engagementType = project.engagement_type ?? "fixed";
  const isRetainer = engagementType === "retainer";

  // Hours consumed this period — same month-window rules as the pulse burn
  // view (frozen snapshots count in full for completed retainers).
  const { start: monthStart, end: monthEnd } = monthRange(currentMonthKey());
  const periodHours = filterBurnActuals(
    actuals,
    project.status === "completed" ? new Set([project.id]) : new Set(),
    monthStart,
    monthEnd,
  ).reduce((s, a) => s + Number(a.actual_hours ?? 0), 0);

  function saveRecurrence() {
    if (!id) return;
    updateProject.mutate(
      {
        id,
        patch: {
          is_recurring: recur.is_recurring,
          recurrence_interval: recur.is_recurring ? recur.recurrence_interval : null,
          recurrence_start: recur.is_recurring && recur.recurrence_start ? recur.recurrence_start : null,
          recurrence_end: recur.is_recurring && recur.recurrence_end ? recur.recurrence_end : null,
        },
      },
      {
        onSuccess: () => toast.success("Recurrence saved"),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  function saveName() {
    if (!id) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast.error("Name can't be empty");
      return;
    }
    if (trimmed === (project.name ?? "")) {
      setNameEditing(false);
      return;
    }
    updateProject.mutate(
      { id, patch: { name: trimmed } },
      {
        onSuccess: () => {
          setNameEditing(false);
          toast.success("Name updated");
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  function saveGitRemote() {
    if (!id || !data) return;
    updateProject.mutate(
      { id, patch: { git_remote_url: remoteDraft.trim() || null } },
      {
        onSuccess: () => toast.success("Git remote saved"),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  function saveDueDate() {
    if (!id) return;
    updateProject.mutate(
      {
        id,
        patch: {
          due_date: dueDateDraft ? new Date(dueDateDraft).toISOString() : null,
        },
      },
      {
        onSuccess: () => toast.success("Due date saved"),
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  function copyCcProject() {
    if (!data) return;
    const payload = {
      project_code: data.project.project_code,
      project_name: data.project.name,
      clickup_parent_task_id: data.project.clickup_parent_task_id,
      calculator_project_id: data.project.id,
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast.success(".cc-project copied — paste into a file at repo root");
  }

  const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
  const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

  const actualsSummary = rows
    .map((r) => `  ${r.dept_name}: ${r.actual}h actual / ${r.planned}h planned`)
    .join("\n");

  const projectPrompts: ClaudePrompt[] = [
    ...(isRetainer
      ? [
          {
            id: "retainer-review",
            label: "Retainer review",
            build: () => `${ROLE}

Context:
Project ID: ${project.id}
Engagement type: retainer
Retainer hours/month: ${project.retainer_hours_target ?? "(not set)"}
Monthly fee: ${project.retainer_monthly_fee_cents != null ? `R${(project.retainer_monthly_fee_cents / 100).toFixed(2)}` : "(not set)"}
Hours used this period: ${totalActual}h of ${totalPlanned}h planned
By department:
${actualsSummary || "  (no actuals)"}

${MCP_NOTE}

Action: Produce a retainer health summary and renewal recommendation. Cover: hours pacing (on track / over / under), value delivered vs fee, and a recommended action (renew as-is, adjust hours, or flag for discussion). Keep it under 200 words.

Output: A short markdown report with sections: Pacing, Value Assessment, Recommendation.`,
          } as ClaudePrompt,
        ]
      : []),
    {
      id: "invoice-line-items",
      label: "Invoice line items",
      build: () => `${ROLE}

Context:
Project ID: ${project.id}
Engagement type: ${engagementType}
Hours delivered this period: ${totalActual}h
By department:
${actualsSummary || "  (no actuals)"}

${MCP_NOTE}

Action: Format the hours above as Xero-ready invoice line item descriptions. For each department with actual hours > 0, produce: description (department + service type + period), quantity (hours), and amount note. Use professional billing language.

Output: A markdown table with columns: Department | Description | Hours | Notes.`,
    },
  ];

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-label-small px-2 py-0.5 rounded-sm bg-m-surface-container border border-m-outline-variant">
                  {project.project_code}
                </span>
                {nameEditing ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName();
                        if (e.key === "Escape") {
                          setNameDraft(project.name ?? "");
                          setNameEditing(false);
                        }
                      }}
                      autoFocus
                      aria-label="Retainer name"
                      className="h-10 text-headline-small min-w-[20rem]"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={saveName}
                      disabled={updateProject.isPending}
                      aria-label="Save name"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setNameDraft(project.name ?? "");
                        setNameEditing(false);
                      }}
                      aria-label="Cancel rename"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="group flex items-center gap-1.5">
                    <h1 className="text-headline-small">{project.name ?? "Untitled project"}</h1>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => setNameEditing(true)}
                      aria-label="Edit name"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="text-label-small text-m-on-surface-variant">
                Started {new Date(project.started_at).toLocaleDateString("en-ZA")} · Status:{" "}
                {project.status}
              </div>
              <div className="mt-2">
                Planned: <strong>{totalPlanned.toFixed(1)}h</strong> · Actual:{" "}
                <strong>{totalActual.toFixed(1)}h</strong>
              </div>
              {progress.taskTotal > 0 && (
                <div
                  className="mt-3 max-w-md"
                  title={`Tasks ${progress.taskComplete}/${progress.taskTotal} (${progressPct}%) · Hours ${progress.actualHours.toFixed(1)}/${progress.plannedHours.toFixed(1)} (${hoursPct}%)`}
                >
                  <div className="mb-1 flex items-center justify-between text-label-small text-m-on-surface-variant">
                    <span>Progress</span>
                    <span className="text-m-on-surface">
                      {progressPct}% · {progress.taskComplete}/{progress.taskTotal} tasks
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
                    <div
                      className="h-full rounded-full bg-m-primary transition-all"
                      style={{ width: `${Math.min(100, progressPct)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sync.mutate(project.id)}
              disabled={sync.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Due date</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Project due date</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={dueDateDraft}
                onChange={(e) => setDueDateDraft(e.target.value)}
              />
              <Button size="sm" onClick={saveDueDate} disabled={updateProject.isPending}>
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for on-time delivery tracking in the ops overview.
            </p>
          </div>
        </CardContent>
      </Card>

      {project.engagement_type === 'retainer' && (
        <Card>
          <CardHeader>
            <CardTitle>Retainer — Monthly target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>Hours target / month</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  defaultValue={project.retainer_hours_target ?? ''}
                  onBlur={e => {
                    const val = parseFloat(e.target.value)
                    if (!isNaN(val)) {
                      updateProject.mutate(
                        { id: project.id, patch: { retainer_hours_target: val } },
                        {
                          onSuccess: () => toast.success("Hours target saved"),
                          onError: (err: Error) => toast.error(err.message),
                        }
                      )
                    }
                  }}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Monthly fee (ZAR)</Label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  defaultValue={project.retainer_monthly_fee_cents != null ? project.retainer_monthly_fee_cents / 100 : ''}
                  onBlur={e => {
                    const val = parseFloat(e.target.value)
                    if (!isNaN(val)) {
                      updateProject.mutate(
                        { id: project.id, patch: { retainer_monthly_fee_cents: Math.round(val * 100) } },
                        {
                          onSuccess: () => toast.success("Monthly fee saved"),
                          onError: (err: Error) => toast.error(err.message),
                        }
                      )
                    }
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          {isRetainer ? (
            project.retainer_hours_target ? (
              <BurnChart
                rows={[
                  {
                    dept_id: "retainer",
                    dept_name: "Hours used this month",
                    planned: project.retainer_hours_target,
                    actual: periodHours,
                  },
                ]}
              />
            ) : (
              <p className="text-body-small text-m-on-surface-variant">
                Set the monthly hours target above to track retainer burn.
              </p>
            )
          ) : (
            <BurnChart rows={rows} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurrence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {project.recurrence_mode === "per_service" && (
            <p className="rounded-lg bg-m-surface-container-low/60 p-3 text-sm text-m-on-surface-variant">
              Per-service recurrence — configured on the original quote. Edit schedules directly
              to adjust.
            </p>
          )}
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={recur.is_recurring}
              onChange={(e) => setRecur({ ...recur, is_recurring: e.target.checked })}
              className="h-4 w-4"
            />
            Recurring project — repeat all tasks on a schedule
          </Label>
          {recur.is_recurring && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Interval</Label>
                <select
                  value={recur.recurrence_interval ?? ""}
                  onChange={(e) =>
                    setRecur({
                      ...recur,
                      recurrence_interval: (e.target.value || null) as RecurrenceInterval | null,
                    })
                  }
                  className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">—</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={recur.recurrence_start}
                  onChange={(e) => setRecur({ ...recur, recurrence_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input
                  type="date"
                  value={recur.recurrence_end}
                  onChange={(e) => setRecur({ ...recur, recurrence_end: e.target.value })}
                  placeholder="Ongoing"
                />
                <p className="text-xs text-muted-foreground">Leave empty for ongoing</p>
              </div>
            </div>
          )}
          <div>
            <Button size="sm" onClick={saveRecurrence} disabled={updateProject.isPending}>
              <Save className="h-4 w-4" />
              {updateProject.isPending ? "Saving…" : "Save recurrence"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {project.engagement_type === 'retainer' && (
        <Card>
          <CardHeader>
            <CardTitle>Recurring services</CardTitle>
          </CardHeader>
          <CardContent>
            <RetainerServicesEditor projectId={project.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-title-small">Tasks</h2>
          <table className="w-full text-body-small">
            <thead>
              <tr className="text-left text-label-small text-m-on-surface-variant">
                <th className="py-1">Task</th>
                <th>Dept</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {actuals.map((a) => (
                <tr key={a.id} className="border-t border-m-outline-variant">
                  <td className="py-1">
                    {a.task_name ? (
                      a.task_name
                    ) : (
                      <span className="font-mono text-xs text-m-on-surface-variant">
                        {a.clickup_task_id}
                      </span>
                    )}
                  </td>
                  <td>{depts.find((d) => d.id === a.dept_id)?.name ?? "—"}</td>
                  <td>{Number(a.planned_hours).toFixed(1)}</td>
                  <td>{Number(a.actual_hours).toFixed(1)}</td>
                  <td>{a.status_at_sync ?? "—"}</td>
                  <td>{a.synced_at ? new Date(a.synced_at).toLocaleTimeString("en-ZA") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="communications">
          <ProjectCommunications projectId={project.id} />
        </TabsContent>
        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Claude Code attribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-body-small text-m-on-surface-variant">
                Token usage from Claude Code sessions in the linked repo will accumulate on the
                ClickUp parent task. The SessionStart hook resolves the binding via either a
                <code className="mx-1 px-1 rounded-sm bg-m-surface-container">.cc-project</code>
                file at repo root, or by matching{" "}
                <code className="mx-1 px-1 rounded-sm bg-m-surface-container">git remote get-url origin</code>{" "}
                against the URL below.
              </div>
              <div className="space-y-2">
                <Label>Git remote URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={remoteDraft}
                    onChange={(e) => setRemoteDraft(e.target.value)}
                    placeholder="https://github.com/org/repo.git"
                    className="font-mono text-xs"
                  />
                  <Button size="sm" onClick={saveGitRemote} disabled={updateProject.isPending}>
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Both HTTPS and SSH forms work — they normalise to the same canonical key.
                </p>
              </div>
              <div>
                <Button size="sm" variant="outline" onClick={copyCcProject}>
                  <Copy className="h-4 w-4" />
                  Copy .cc-project
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Paste into a file named <code>.cc-project</code> at the repo root and commit it
                  — the binding is a property of the codebase.
                </p>
              </div>
            </CardContent>
          </Card>

          <ClaudePromptPanel prompts={projectPrompts} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
