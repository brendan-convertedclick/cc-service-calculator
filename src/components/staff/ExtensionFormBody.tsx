import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { classifyTier, initialStatusForTier } from "@/types/extension-requests";

type ClientOption = { id: string; name: string };
type CuTaskOption = {
  id: string;
  name: string;
  list_name: string;
  sprint_points: number | null;
};

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Phase 2 extension request form. Submitter picks a client, then an open
 * task assigned to them in that client's folder, then requests extra
 * sprint points with a reason. Tier is computed live for transparency.
 */
export function ExtensionFormBody() {
  const { currentUserId } = useAuth();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [tasks, setTasks] = useState<CuTaskOption[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [clientId, setClientId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");
  const [extraPoints, setExtraPoints] = useState<string>("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .is("archived_at", null)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Could not load clients: ${error.message}`);
        return;
      }
      setClients((data ?? []) as ClientOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const tierPreview = useMemo(() => {
    const original = selectedTask?.sprint_points ?? 0;
    const extra = Number(extraPoints);
    if (!original || !extra || extra <= 0) return null;
    return classifyTier(original, extra);
  }, [selectedTask?.sprint_points, extraPoints]);

  const canSubmit =
    !!currentUserId &&
    !!clientId &&
    !!selectedTask &&
    !!selectedTask.sprint_points &&
    Number(extraPoints) > 0 &&
    reason.trim().length > 0 &&
    !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedTask || !selectedTask.sprint_points || !tierPreview) return;
    setSubmitting(true);
    try {
      const extra = Number(extraPoints);
      const status = initialStatusForTier(tierPreview.tier);
      const insertPayload = {
        requester_id: currentUserId,
        client_id: clientId,
        parent_clickup_task_id: selectedTask.id,
        parent_task_name: selectedTask.name,
        original_points: selectedTask.sprint_points,
        extra_points: extra,
        delta_pct: tierPreview.deltaPct,
        tier: tierPreview.tier,
        reason: reason.trim(),
        status,
      };
      const { data: inserted, error } = await supabase
        // @ts-expect-error extension_requests added by migration 0053
        .from("extension_requests")
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      // Auto-tier fires the approval pipeline immediately.
      if (tierPreview.tier === "auto") {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`${FUNCTIONS_BASE}/approve-extension-request`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ extension_request_id: (inserted as { id: string }).id }),
        });
        const body = (await res.json()) as { error?: string; clickup_subtask_url?: string };
        if (!res.ok) {
          toast.error(`Auto-push failed (row saved): ${body.error ?? res.statusText}`);
          return;
        }
        toast.success("Auto-approved · ClickUp subtask created.");
      } else if (tierPreview.tier === "admin") {
        toast.success("Submitted · awaiting admin approval.");
      } else {
        toast.success("Submitted · escalated to owner.");
      }
      setExtraPoints("1");
      setReason("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ext-client">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="ext-client">
              <SelectValue placeholder="Pick a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ext-task">Task</Label>
          <Select value={taskId} onValueChange={setTaskId} disabled={!clientId || loadingTasks}>
            <SelectTrigger id="ext-task">
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
                  {t.sprint_points !== null && (
                    <span className="text-m-on-surface-variant ml-2 text-label-small">
                      · {t.sprint_points}pt · {t.list_name}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tasksError && <p className="text-body-small text-destructive">{tasksError}</p>}
        </div>
      </div>

      {selectedTask && selectedTask.sprint_points === null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          This task has no Sprint Points custom field set in ClickUp. Extension requests
          need a starting budget to compute the % delta. Set it on the ClickUp task first.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[160px,1fr]">
        <div className="space-y-2">
          <Label htmlFor="ext-extra">Extra sprint points</Label>
          <Input
            id="ext-extra"
            type="number"
            min={0.25}
            step={0.25}
            value={extraPoints}
            onChange={(e) => setExtraPoints(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Tier preview</Label>
          <div className="flex h-10 items-center gap-3 rounded-md border border-m-outline-variant bg-m-surface px-3">
            {tierPreview ? (
              <>
                <Badge variant={tierBadgeVariant(tierPreview.tier)}>
                  {tierPreview.tier}
                </Badge>
                <span className="text-body-small text-m-on-surface">
                  +{tierPreview.deltaPct}% delta
                </span>
                <span className="text-label-small text-m-on-surface-variant">
                  · {tierLabel(tierPreview.tier)}
                </span>
              </>
            ) : (
              <span className="text-body-small text-m-on-surface-variant">
                Pick a task with points to preview the tier.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ext-reason">Reason for extension</Label>
        <Textarea
          id="ext-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What's pushed the work past its budget? Be specific."
          rows={4}
        />
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button type="submit" disabled={!canSubmit} className="gap-2">
          <ArrowUpCircle className="h-4 w-4" />
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}

function tierBadgeVariant(tier: "auto" | "admin" | "owner") {
  if (tier === "auto") return "success" as const;
  if (tier === "admin") return "warning" as const;
  return "destructive" as const;
}

function tierLabel(tier: "auto" | "admin" | "owner"): string {
  if (tier === "auto") return "auto-approved on submit";
  if (tier === "admin") return "admin approval required";
  return "owner escalation required";
}
