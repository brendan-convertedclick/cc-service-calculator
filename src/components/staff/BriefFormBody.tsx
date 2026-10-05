import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NO_WORKFLOW, WorkflowSelect } from "@/components/systems/WorkflowSelect";
import { useStaffClients } from "./useStaffClients";

type ListOption = { id: string; name: string; work_stream?: string | null };

/**
 * Phase 1 staff brief form body. Used inside StaffPortal's "New brief" tab.
 */
export function BriefFormBody() {
  const { currentUserId } = useAuth();
  const clients = useStaffClients();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  const [clientId, setClientId] = useState<string>("");
  const [listId, setListId] = useState<string>("");
  const [taskName, setTaskName] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [hours, setHours] = useState<string>("0.25");
  const [isInternal, setIsInternal] = useState(false);
  const [systemId, setSystemId] = useState<string>(NO_WORKFLOW);
  const [goal, setGoal] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [measurableOutcome, setMeasurableOutcome] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        setLists(body.lists ?? []);
        setListId("");
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

  const visibleClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, clientQuery]);

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
      const { data: inserted, error } = await supabase
        .from("staff_briefs")
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      toast.success("Brief submitted for approval.");
      // Fire-and-forget: ping admins in ClickUp chat + email. Never blocks
      // the submit — the request is already saved either way.
      callEdgeFn("notify-staff-brief", { staff_brief_id: (inserted as { id: string }).id }).catch(() => {});
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
      <div className="space-y-2">
        <Label htmlFor="brief-client-search">Client</Label>
        <div className="space-y-2 rounded-lg border border-m-outline-variant bg-m-surface-container-low p-2">
          <Input
            id="brief-client-search"
            value={clientQuery}
            onChange={(e) => setClientQuery(e.target.value)}
            placeholder="Search…"
          />
          <div
            role="listbox"
            aria-label="Client"
            className="max-h-64 space-y-0.5 overflow-y-auto sm:max-h-[36rem]"
          >
            {visibleClients.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === clientId}
                onClick={() => setClientId(c.id)}
                className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-label-large tracking-normal transition-colors ${
                  c.id === clientId
                    ? "bg-m-primary-container font-medium text-m-on-primary-container"
                    : "text-m-on-surface hover:bg-m-surface-container-high"
                }`}
              >
                {c.name}
              </button>
            ))}
            {visibleClients.length === 0 && (
              <p className="px-2.5 py-1.5 text-label-medium text-m-on-surface-variant">No match</p>
            )}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        <ClickUpListSelect
          id="brief-list"
          lists={lists}
          value={listId}
          onValueChange={setListId}
          hasClient={!!clientId}
          loading={loadingLists}
          error={listsError}
        />

        <div className="grid gap-4 sm:grid-cols-[1fr,140px]">
          <div className="space-y-2">
            <Label htmlFor="brief-task-name">Task name</Label>
            <Input
              id="brief-task-name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Short, specific, action-oriented"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brief-hours">Estimated time</Label>
            <Input
              id="brief-hours"
              type="number"
              min={0.25}
              step={0.25}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <p className="text-label-small text-m-on-surface-variant">In hours. 0.25 = 15 min</p>
          </div>
        </div>

        <WorkflowSelect
          id="brief-workflow"
          value={systemId}
          onValueChange={setSystemId}
          hint="Optional — its process steps become the ClickUp task's checklist when this brief is approved."
        />

        <div className="flex items-center justify-between rounded-lg border border-m-outline-variant bg-m-surface px-4 py-3">
          <div>
            <Label htmlFor="brief-is-internal" className="text-body-medium text-m-on-surface">
              Internal project
            </Label>
            <p className="text-label-small text-m-on-surface-variant">
              Off = client work · On = internal initiative
            </p>
          </div>
          <Switch id="brief-is-internal" checked={isInternal} onCheckedChange={setIsInternal} />
        </div>

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
            {submitting ? "Submitting…" : "Submit for approval"}
          </Button>
        </div>
      </div>
    </form>
  );
}
