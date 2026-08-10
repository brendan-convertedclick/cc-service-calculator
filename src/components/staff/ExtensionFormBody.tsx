import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
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
import {
  classifyDueDateTier,
  classifyTier,
  initialStatusForTier,
  maxTier,
} from "@/types/extension-requests";
import { ClientSelectField } from "./ClientSelectField";
import { useStaffClients } from "./useStaffClients";

type CuTaskOption = {
  id: string;
  name: string;
  list_name: string;
  sprint_points: number | null;
  due_date: number | null;
};

function toDateInputValue(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Whole days between a task's current due date and a requested new date. */
function daysBetween(fromEpochMs: number, toDateStr: string): number {
  const from = new Date(fromEpochMs);
  from.setHours(0, 0, 0, 0);
  const to = new Date(`${toDateStr}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Phase 2 extension request form. Submitter picks a client, then an open
 * task assigned to them in that client's folder, then requests extra
 * sprint points with a reason. Tier is computed live for transparency.
 */
export function ExtensionFormBody() {
  const { currentUserId } = useAuth();
  const clients = useStaffClients();
  const [tasks, setTasks] = useState<CuTaskOption[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [clientId, setClientId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");
  const [extraPoints, setExtraPoints] = useState<string>("");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");
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
        const body = await callEdgeFn<{ tasks?: CuTaskOption[] }>("list-my-open-clickup-tasks", {
          client_id: clientId,
        });
        if (cancelled) return;
        setTasks(body.tasks ?? []);
        setTaskId("");
      } catch (e) {
        if (cancelled) return;
        setTasksError(errorMessage(e));
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

  // Points are only mandatory when the requester is actually asking for
  // extra points — a due-date-only request has nothing to state a budget
  // for, so a blank field defaults to 0 rather than blocking submission.
  const budgetStated = extraPoints.trim() === "" || (Number.isFinite(Number(extraPoints)) && Number(extraPoints) >= 0);
  const pointsRequested = extraPoints.trim() !== "" && Number(extraPoints) > 0;
  const pointsTier = useMemo(() => {
    const original = selectedTask?.sprint_points ?? 0;
    const extra = Number(extraPoints);
    if (!original || !extra || extra <= 0) return null;
    return classifyTier(original, extra);
  }, [selectedTask?.sprint_points, extraPoints]);

  const dueDateRequested = dueDate.trim() !== "";
  const daysRequested = useMemo(() => {
    if (!dueDate || !selectedTask?.due_date) return null;
    return daysBetween(selectedTask.due_date, dueDate);
  }, [selectedTask?.due_date, dueDate]);
  const dueDateTier = useMemo(() => {
    if (daysRequested === null || daysRequested <= 0) return null;
    return classifyDueDateTier(daysRequested);
  }, [daysRequested]);

  const tierPreview = useMemo(() => {
    if (!pointsTier && !dueDateTier) return null;
    const tier = pointsTier && dueDateTier ? maxTier(pointsTier.tier, dueDateTier.tier) : (pointsTier ?? dueDateTier)!.tier;
    return { tier, deltaPct: pointsTier?.deltaPct ?? null, daysRequested: dueDateTier ? daysRequested : null };
  }, [pointsTier, dueDateTier, daysRequested]);

  const pointsValid = !pointsRequested || (!!selectedTask?.sprint_points && !!pointsTier && reason.trim().length > 0);
  const dueDateValid =
    !dueDateRequested || (!!selectedTask?.due_date && daysRequested !== null && daysRequested > 0 && dueDateReason.trim().length > 0);

  const canSubmit =
    !!currentUserId &&
    !!clientId &&
    !!selectedTask &&
    budgetStated &&
    (pointsRequested || dueDateRequested) &&
    pointsValid &&
    dueDateValid &&
    !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedTask || !tierPreview) return;
    setSubmitting(true);
    try {
      const status = initialStatusForTier(tierPreview.tier);
      const insertPayload: Record<string, unknown> = {
        requester_id: currentUserId,
        client_id: clientId,
        parent_clickup_task_id: selectedTask.id,
        parent_task_name: selectedTask.name,
        tier: tierPreview.tier,
        status,
      };
      // The budget always goes on the row — a stated 0 is what tells the
      // approver this costs nothing, and it's the difference between "no extra
      // points needed" and nobody having said.
      insertPayload.extra_points = extraPoints.trim() === "" ? 0 : Number(extraPoints);
      insertPayload.delta_pct = pointsTier?.deltaPct ?? (pointsRequested ? null : 0);
      if (selectedTask.sprint_points) insertPayload.original_points = selectedTask.sprint_points;
      if (pointsRequested) insertPayload.reason = reason.trim();
      if (dueDateRequested) {
        insertPayload.original_due_date = selectedTask.due_date ? toDateInputValue(selectedTask.due_date) : null;
        insertPayload.requested_due_date = dueDate;
        insertPayload.due_date_reason = dueDateReason.trim();
      }
      const { data: inserted, error } = await supabase
        .from("extension_requests")
        // @ts-expect-error extension_requests columns extended by migration 0094; shape varies by which fields are requested
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      // Auto-tier fires the approval pipeline immediately.
      if (tierPreview.tier === "auto") {
        try {
          await callEdgeFn("approve-extension-request", {
            extension_request_id: (inserted as { id: string }).id,
          });
        } catch (e) {
          toast.error(`Auto-push failed (row saved): ${errorMessage(e)}`);
          return;
        }
        toast.success("Auto-approved · ClickUp subtask created.");
      } else {
        toast.success(
          tierPreview.tier === "admin"
            ? "Submitted · awaiting admin approval."
            : "Submitted · admin reviews first, then the owner signs off.",
        );
        // Fire-and-forget: ping the approver(s) in ClickUp chat + email. Never
        // blocks the submit — the request is already saved either way.
        callEdgeFn("notify-extension-request", {
          extension_request_id: (inserted as { id: string }).id,
        }).catch(() => {});
      }
      setExtraPoints("");
      setReason("");
      setDueDate("");
      setDueDateReason("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <ClientSelectField id="ext-client" clients={clients} value={clientId} onValueChange={setClientId} />
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
                  <span className="text-m-on-surface-variant ml-2 text-label-small">
                    · {t.sprint_points !== null ? `${t.sprint_points}pt` : "no points"} · {t.list_name}
                    {t.due_date !== null && <> · due {toDateInputValue(t.due_date)}</>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tasksError && <p className="text-body-small text-destructive">{tasksError}</p>}
        </div>
      </div>

      {selectedTask && pointsRequested && selectedTask.sprint_points === null && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          This task has no Sprint Points custom field set in ClickUp. Extension requests
          need a starting budget to compute the % delta. Set it on the ClickUp task first.
        </div>
      )}
      {selectedTask && dueDateRequested && selectedTask.due_date === null && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          This task has no due date set in ClickUp. Set one there first so the days-requested
          delta can be computed.
        </div>
      )}
      {selectedTask && dueDateRequested && daysRequested !== null && daysRequested <= 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-body-small text-amber-900">
          The new due date must be after the current one ({toDateInputValue(selectedTask.due_date!)}).
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ext-extra">Extra sprint points</Label>
          <Input
            id="ext-extra"
            type="number"
            min={0}
            step={0.25}
            aria-describedby="ext-extra-help"
            placeholder="e.g. 4"
            value={extraPoints}
            onChange={(e) => setExtraPoints(e.target.value)}
          />
          <p id="ext-extra-help" className="text-label-small text-m-on-surface-variant">
            Leave blank if this is only a due-date push with no extra budget needed.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ext-reason">Reason for extra points</Label>
          <Textarea
            id="ext-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's pushed the work past its budget? Be specific."
            rows={2}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ext-due-date">New due date</Label>
          <Input
            id="ext-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ext-due-reason">Reason for due date extension</Label>
          <Textarea
            id="ext-due-reason"
            value={dueDateReason}
            onChange={(e) => setDueDateReason(e.target.value)}
            placeholder="What's pushed the deadline out? Be specific."
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tier preview</Label>
        <div className="flex h-10 items-center gap-3 rounded-md border border-m-outline-variant bg-m-surface px-3">
          {tierPreview ? (
            <>
              <Badge variant={tierBadgeVariant(tierPreview.tier)}>
                {tierPreview.tier}
              </Badge>
              {tierPreview.deltaPct !== null && (
                <span className="text-body-small text-m-on-surface">
                  +{tierPreview.deltaPct}% points delta
                </span>
              )}
              {tierPreview.daysRequested !== null && (
                <span className="text-body-small text-m-on-surface">
                  +{tierPreview.daysRequested} day{tierPreview.daysRequested === 1 ? "" : "s"}
                </span>
              )}
              <span className="text-label-small text-m-on-surface-variant">
                · {tierLabel(tierPreview.tier)}
              </span>
            </>
          ) : (
            <span className="text-body-small text-m-on-surface-variant">
              Request extra points and/or a new due date to preview the tier.
            </span>
          )}
        </div>
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
  return "admin approval, then owner sign-off";
}
