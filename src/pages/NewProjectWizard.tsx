import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useClients } from "@/hooks/useClients";
import { useCreateAdhocProject, type AdhocTaskInput } from "@/hooks/useCreateAdhocProject";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";
const STATUS_DEFAULT = "__default__";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type ListStatus = { status: string; color: string | null; type: string; orderindex: number };
type ListOption = { id: string; name: string; statuses: ListStatus[] };
type WorkStreamOption = { id: string; name: string };

type TaskRow = {
  key: string;
  task_name: string;
  assignee: string;
  sprint_points: number;
  work_stream: string;
  status: string;
  due_date: string;
};

function newRow(): TaskRow {
  return {
    key: crypto.randomUUID(),
    task_name: "",
    assignee: UNASSIGNED,
    sprint_points: 1,
    work_stream: "",
    status: STATUS_DEFAULT,
    due_date: "",
  };
}

/**
 * Single-panel builder for a non-recurring adhoc project. Picks a client, names
 * the project, then adds one or more task rows. On Create the edge function makes
 * a new ClickUp list + parent task + one child task per row, records the project
 * and per-task actuals in Conductor, and navigates to the new project.
 */
export function NewProjectWizard() {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { data: departments = [] } = useDepartments();
  const createProject = useCreateAdhocProject();

  const [clientId, setClientId] = useState<string>("");
  const [projectName, setProjectName] = useState("");
  const [rows, setRows] = useState<TaskRow[]>([newRow()]);

  const [workStreamOptions, setWorkStreamOptions] = useState<WorkStreamOption[]>([]);
  const [statuses, setStatuses] = useState<ListStatus[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  // Fetch the client's ClickUp lists + work-stream options ONCE when a client is
  // picked. The new project's list is created in the same Space, so statuses are
  // inherited — we can safely take them from any sibling list to populate every
  // task row's Status picker. Work-stream options are Space-level (top-level).
  useEffect(() => {
    if (!clientId) {
      setWorkStreamOptions([]);
      setStatuses([]);
      setListsError(null);
      return;
    }
    let cancelled = false;
    setLoadingLists(true);
    setListsError(null);
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`${FUNCTIONS_BASE}/list-client-clickup-lists`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ client_id: clientId }),
        });
        const body = (await res.json()) as {
          lists?: ListOption[];
          work_stream_options?: WorkStreamOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setListsError(body.error ?? "Failed to load lists");
          setWorkStreamOptions([]);
          setStatuses([]);
          return;
        }
        setWorkStreamOptions(body.work_stream_options ?? []);
        // Statuses are Space-inherited — take them from any returned list.
        const withStatuses = (body.lists ?? []).find((l) => (l.statuses ?? []).length > 0);
        setStatuses(withStatuses?.statuses ?? []);
      } catch (e) {
        if (cancelled) return;
        setListsError(errorMessage(e));
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Statuses are scoped to whichever client's list is selected — reset every
  // row's status back to the list default whenever the client changes, so a
  // status picked for a previous client's status set can't be submitted
  // against a different client (would land the task in task_failures).
  useEffect(() => {
    setRows((prev) => prev.map((r) => ({ ...r, status: STATUS_DEFAULT })));
  }, [clientId]);

  // ClickUp's actual "Work Stream" custom-field options are the source of truth.
  // If the fetch failed (or returned none), fall back to Conductor's departments
  // so the operator is never hard-blocked from creating a project.
  const workStreamSource = workStreamOptions.length > 0 ? workStreamOptions : departments;
  const offeredWorkStreams = useMemo(
    () => new Set(workStreamSource.map((d) => d.name)),
    [workStreamSource],
  );

  const updateRow = (key: string, patch: Partial<TaskRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  const namedRows = rows.filter((r) => r.task_name.trim().length > 0);
  const totalPoints = namedRows.reduce((sum, r) => sum + Math.max(1, Math.round(r.sprint_points || 1)), 0);

  const allWorkStreamsValid = namedRows.every((r) => offeredWorkStreams.has(r.work_stream));
  const canCreate =
    Boolean(clientId) &&
    projectName.trim().length > 0 &&
    namedRows.length > 0 &&
    allWorkStreamsValid &&
    !createProject.isPending;

  const handleCreate = async () => {
    const tasks: AdhocTaskInput[] = namedRows.map((r) => ({
      task_name: r.task_name.trim(),
      assignee_member_id: r.assignee === UNASSIGNED ? null : r.assignee,
      sprint_points: Math.max(1, Math.round(r.sprint_points || 1)),
      work_stream: r.work_stream,
      status: r.status === STATUS_DEFAULT ? undefined : r.status,
      due_date: r.due_date || null,
    }));

    try {
      const result = await createProject.mutateAsync({
        client_id: clientId,
        project_name: projectName.trim(),
        tasks,
      });
      toast.success("Project created in ClickUp");
      if (result.task_failures && result.task_failures.length > 0) {
        toast.warning(
          `Project created, but ${result.task_failures.length} task${
            result.task_failures.length === 1 ? "" : "s"
          } failed to create.`,
        );
      }
      navigate(`/projects/${result.project_id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const saving = createProject.isPending;

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-6">
        <Link to="/projects" className="text-label-medium text-m-primary hover:underline">
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-headline-medium">New project</h1>
        <p className="mt-1 text-body-medium text-m-on-surface-variant">
          Create a one-off project for a client. On Create this makes a new ClickUp list, a parent
          task, and one child task per row.
        </p>
      </div>

      <div className="space-y-5 rounded-md border border-m-outline-variant bg-m-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="np-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="np-client">
                <SelectValue placeholder="Choose a client…" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadingLists && (
              <p className="text-body-small text-m-on-surface-variant">Loading ClickUp options…</p>
            )}
            {listsError && (
              <p className="text-body-small text-destructive">
                Couldn't load ClickUp options ({listsError}) — Work Stream falls back to departments.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-name">Project name</Label>
            <Input
              id="np-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Website refresh"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-title-small text-m-on-surface">Tasks</h2>
            <span className="text-label-medium text-m-on-surface-variant">
              {namedRows.length} task{namedRows.length === 1 ? "" : "s"} · {totalPoints} pts
            </span>
          </div>

          <div className="space-y-4">
            {rows.map((row, idx) => {
              const wsValid =
                row.task_name.trim().length === 0 || offeredWorkStreams.has(row.work_stream);
              return (
                <div
                  key={row.key}
                  className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface-container-low p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-label-medium text-m-on-surface-variant">
                      Task {idx + 1}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={rows.length === 1}
                      onClick={() => removeRow(row.key)}
                      aria-label="Remove task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`np-task-${row.key}`}>Task name</Label>
                    <Input
                      id={`np-task-${row.key}`}
                      value={row.task_name}
                      onChange={(e) => updateRow(row.key, { task_name: e.target.value })}
                      placeholder="What needs doing?"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`np-assignee-${row.key}`}>Assignee</Label>
                      <Select
                        value={row.assignee}
                        onValueChange={(v) => updateRow(row.key, { assignee: v })}
                      >
                        <SelectTrigger id={`np-assignee-${row.key}`}>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                          {team.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`np-points-${row.key}`}>Sprint points</Label>
                      <Input
                        id={`np-points-${row.key}`}
                        type="number"
                        min={1}
                        step={1}
                        value={row.sprint_points}
                        onChange={(e) =>
                          updateRow(row.key, { sprint_points: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`np-ws-${row.key}`}>Work stream</Label>
                      <Select
                        value={row.work_stream}
                        onValueChange={(v) => updateRow(row.key, { work_stream: v })}
                      >
                        <SelectTrigger id={`np-ws-${row.key}`}>
                          <SelectValue placeholder="Choose a work stream…" />
                        </SelectTrigger>
                        <SelectContent>
                          {workStreamSource.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!wsValid && (
                        <p className="text-body-small text-m-on-surface-variant">
                          Pick a work stream — it sets the ClickUp dropdown and the invoice trail.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`np-status-${row.key}`}>Status</Label>
                      <Select
                        value={row.status}
                        onValueChange={(v) => updateRow(row.key, { status: v })}
                        disabled={statuses.length === 0}
                      >
                        <SelectTrigger id={`np-status-${row.key}`}>
                          <SelectValue placeholder="— List default —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={STATUS_DEFAULT}>— List default —</SelectItem>
                          {statuses.map((s) => (
                            <SelectItem key={s.status} value={s.status}>
                              {s.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2 sm:max-w-[calc(50%-0.375rem)]">
                    <Label htmlFor={`np-due-${row.key}`}>Due date</Label>
                    <Input
                      id={`np-due-${row.key}`}
                      type="date"
                      value={row.due_date}
                      onChange={(e) => updateRow(row.key, { due_date: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <Button variant="outline" onClick={addRow}>
            + Add task
          </Button>
        </div>

        <div className="flex items-center justify-between border-t border-m-outline-variant pt-4">
          <span className="text-body-medium text-m-on-surface-variant">
            {namedRows.length} task{namedRows.length === 1 ? "" : "s"} · {totalPoints} sprint points
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild disabled={saving}>
              <Link to="/projects">Cancel</Link>
            </Button>
            <Button disabled={!canCreate} onClick={handleCreate}>
              {saving ? "Creating…" : "Create project"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewProjectWizard;
