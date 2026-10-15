import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClickUpListSelect } from "@/components/ClickUpListSelect";
import { TimePresetField } from "@/components/TimePresetField";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NO_WORKFLOW, WorkflowSelect } from "@/components/systems/WorkflowSelect";
import { ClientListPicker } from "./ClientListPicker";
import { useStaffClients } from "./useStaffClients";
import { pointsToHours } from "@/lib/sprint-points";
import type { StaffBriefRow } from "@/types/staff-briefs";

type ListOption = { id: string; name: string; work_stream?: string | null };

/**
 * Phase 1 staff brief form body. Used inside StaffPortal's "New brief" tab,
 * and pre-filled with `editing` when an approver sent a brief back for
 * changes: submitting then updates that row and returns it to the queue.
 */
export function BriefFormBody({
  editing,
  onDone,
}: {
  editing?: StaffBriefRow & { system_id?: string | null };
  onDone?: () => void;
} = {}) {
  const { currentUserId } = useAuth();
  const clients = useStaffClients();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  const [clientId, setClientId] = useState<string>(editing?.client_id ?? "");
  const [listId, setListId] = useState<string>("");
  const [taskName, setTaskName] = useState(editing?.task_name ?? "");
  const [hours, setHours] = useState<string>(editing ? String(pointsToHours(Number(editing.sprint_points))) : "0.25");
  const [isInternal, setIsInternal] = useState(editing?.is_internal ?? false);
  const [systemId, setSystemId] = useState<string>(editing?.system_id ?? NO_WORKFLOW);
  const [goal, setGoal] = useState(editing?.goal ?? "");
  const [successCriteria, setSuccessCriteria] = useState(editing?.success_criteria ?? "");
  const [measurableOutcome, setMeasurableOutcome] = useState(editing?.measurable_outcome ?? "");
  const [submitting, setSubmitting] = useState(false);
  // The edited brief's list, restored once its client's lists have loaded.
  const keepListId = useRef(editing?.clickup_list_id ?? "");

  useEffect(() => {
    if (!clientId) {
      setLists([]);
      setListId("");
      return;
    }
    let cancelled = false;
    setLoadingLists(true);
    setListsError(null);
    (async () => {
      try {
        const body = await callEdgeFn<{ lists?: ListOption[] }>("list-client-clickup-lists", {
          client_id: clientId,
        });
        if (cancelled) return;
        const loaded = body.lists ?? [];
        setLists(loaded);
        setListId(loaded.some((l) => l.id === keepListId.current) ? keepListId.current : "");
        keepListId.current = "";
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

  const selectedList = useMemo(
    () => lists.find((l) => l.id === listId),
    [lists, listId],
  );

  const canSubmit =
    !!currentUserId &&
    !!clientId &&
    !!listId &&
    taskName.trim().length > 0 &&
    Number(hours) > 0 &&
    goal.trim().length > 0 &&
    successCriteria.trim().length > 0 &&
    measurableOutcome.trim().length > 0 &&
    !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const insertPayload = {
        submitter_id: currentUserId,
        client_id: clientId,
        clickup_list_id: listId,
        clickup_list_name: selectedList?.name ?? "",
        task_name: taskName.trim(),
        // Staff estimate in time; the column stays points (1 pt = 15 min).
        sprint_points: Number(hours) * 4,
        is_internal: isInternal,
        // Resolved to a ClickUp checklist at approval time, not now — steps
        // edited in /systems before approval still land on the task.
        system_id: systemId === NO_WORKFLOW ? null : systemId,
        goal: goal.trim(),
        success_criteria: successCriteria.trim(),
        measurable_outcome: measurableOutcome.trim(),
      };
      const { submitter_id: _submitter, ...edits } = insertPayload;
      const { data: saved, error } = await (editing
        ? supabase
            .from("staff_briefs")
            .update({ ...edits, status: "pending_approval" })
            .eq("id", editing.id)
            .select("id")
            .single()
        : supabase.from("staff_briefs").insert(insertPayload).select("id").single());
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      toast.success(editing ? "Brief resubmitted for approval." : "Brief submitted for approval.");
      // Fire-and-forget: ping admins in ClickUp chat + email. Never blocks
      // the submit — the request is already saved either way.
      callEdgeFn("notify-staff-brief", { staff_brief_id: (saved as { id: string }).id }).catch(() => {});
      if (editing) return onDone?.();
      setTaskName("");
      setHours("0.25");
      setIsInternal(false);
      setSystemId(NO_WORKFLOW);
      setGoal("");
      setSuccessCriteria("");
      setMeasurableOutcome("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 sm:grid-cols-[220px,1fr]">
      <ClientListPicker id="brief-client" clients={clients} value={clientId} onValueChange={setClientId} />

      <div className="min-w-0 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="brief-task-name">Task name</Label>
          <Input
            id="brief-task-name"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Short, specific, action-oriented"
          />
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-[1fr,auto]">
          <ClickUpListSelect
            id="brief-list"
            lists={lists}
            value={listId}
            onValueChange={setListId}
            hasClient={!!clientId}
            loading={loadingLists}
            error={listsError}
          />
          <div className="space-y-2">
            <Label htmlFor="brief-is-internal">Work type</Label>
            <div className="flex h-10 items-center gap-2">
              <Switch id="brief-is-internal" checked={isInternal} onCheckedChange={setIsInternal} />
              <span className="w-16 text-body-medium text-m-on-surface">
                {isInternal ? "Internal" : "Client"}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brief-hours">Estimated time</Label>
          <TimePresetField id="brief-hours" value={hours} onChange={setHours} />
        </div>

        <WorkflowSelect
          id="brief-workflow"
          value={systemId}
          onValueChange={setSystemId}
          hint="Optional — its process steps become the ClickUp task's checklist when this brief is approved."
        />

        <div className="space-y-2">
          <Label htmlFor="brief-goal">What do you want to achieve?</Label>
          <Textarea
            id="brief-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="The outcome you're aiming for."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brief-success">What does success look like?</Label>
          <Textarea
            id="brief-success"
            value={successCriteria}
            onChange={(e) => setSuccessCriteria(e.target.value)}
            placeholder="Describe the finished state."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brief-measurable">What's the expected output, in numbers?</Label>
          <Textarea
            id="brief-measurable"
            value={measurableOutcome}
            onChange={(e) => setMeasurableOutcome(e.target.value)}
            placeholder="e.g. 40 creatives, 1 Excel export, 3 landing pages — a count someone can check this against later."
            rows={3}
          />
        </div>

        <div className="flex items-center justify-end pt-2">
          <Button type="submit" disabled={!canSubmit} className="gap-2">
            <Send className="h-4 w-4" />
            {submitting ? "Submitting…" : editing ? "Resubmit for approval" : "Submit for approval"}
          </Button>
        </div>
      </div>
    </form>
  );
}
