import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REVISION_SUFFIXES, type RevisionSuffix } from "@/types/revision-requests";
import { ClientSelectField } from "./ClientSelectField";
import { useStaffClients } from "./useStaffClients";

type CuTaskOption = { id: string; name: string; list_name: string };

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Request a new revision-stage task (same base name, new DFT/REV suffix) for
 * an existing open task. Always needs admin approval — see
 * approve-revision-request.
 */
export function RevisionFormBody() {
  const { currentUserId } = useAuth();
  const clients = useStaffClients();
  const [tasks, setTasks] = useState<CuTaskOption[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [clientId, setClientId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");
  const [revisionSuffix, setRevisionSuffix] = useState<RevisionSuffix | "">("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setTasks([]);
      setTaskId("");
      return;
    }
    let cancelled = false;
    setLoadingTasks(true);
    setTasksError(null);
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`${FUNCTIONS_BASE}/list-my-open-clickup-tasks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ client_id: clientId }),
        });
        const body = (await res.json()) as { tasks?: CuTaskOption[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setTasksError(body.error ?? "Failed to load tasks");
          setTasks([]);
          setTaskId("");
          return;
        }
        setTasks(body.tasks ?? []);
        setTaskId("");
      } catch (e) {
        if (cancelled) return;
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId],
  );

  const canSubmit = !!currentUserId && !!clientId && !!selectedTask && !!revisionSuffix && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedTask || !revisionSuffix) return;
    setSubmitting(true);
    try {
      const { data: inserted, error } = await supabase
        .from("revision_requests")
        .insert({
          requester_id: currentUserId,
          client_id: clientId,
          parent_clickup_task_id: selectedTask.id,
          parent_task_name: selectedTask.name,
          revision_suffix: revisionSuffix,
          status: "pending_admin",
        })
        .select("id")
        .single();
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      toast.success("Submitted · awaiting admin approval.");
      // Fire-and-forget: ping admins in ClickUp chat + email. Never blocks
      // the submit — the request is already saved either way.
      const session = (await supabase.auth.getSession()).data.session;
      fetch(`${FUNCTIONS_BASE}/notify-revision-request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ revision_request_id: (inserted as { id: string }).id }),
      }).catch(() => {});
      setRevisionSuffix("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <ClientSelectField id="rev-client" clients={clients} value={clientId} onValueChange={setClientId} />
        <div className="space-y-2">
          <Label htmlFor="rev-task">Task</Label>
          <Select value={taskId} onValueChange={setTaskId} disabled={!clientId || loadingTasks}>
            <SelectTrigger id="rev-task">
              <SelectValue
                placeholder={
                  !clientId
                    ? "Pick a client first"
                    : loadingTasks
                      ? "Loading your tasks…"
                      : tasks.length === 0
                        ? "No open tasks assigned to you"
                        : "Pick a task"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  <span className="text-m-on-surface-variant ml-2 text-label-small">
                    · {t.list_name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tasksError && <p className="text-body-small text-destructive">{tasksError}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rev-suffix">Revision</Label>
        <Select value={revisionSuffix} onValueChange={(v) => setRevisionSuffix(v as RevisionSuffix)}>
          <SelectTrigger id="rev-suffix">
            <SelectValue placeholder="Pick the revision stage" />
          </SelectTrigger>
          <SelectContent>
            {REVISION_SUFFIXES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button type="submit" disabled={!canSubmit} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {submitting ? "Submitting…" : "Submit revision request"}
        </Button>
      </div>
    </form>
  );
}
