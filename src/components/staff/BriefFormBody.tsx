import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ClientOption = { id: string; name: string };
type ListOption = { id: string; name: string };

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Phase 1 staff brief form body. Used inside StaffPortal's "New brief" tab.
 */
export function BriefFormBody() {
  const { currentUserId } = useAuth();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  const [clientId, setClientId] = useState<string>("");
  const [listId, setListId] = useState<string>("");
  const [taskName, setTaskName] = useState("");
  const [sprintPoints, setSprintPoints] = useState<string>("1");
  const [isInternal, setIsInternal] = useState(false);
  const [goal, setGoal] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [measurableOutcome, setMeasurableOutcome] = useState("");
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
      setLists([]);
      setListId("");
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
        const body = (await res.json()) as { lists?: ListOption[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setListsError(body.error ?? "Failed to load lists");
          setLists([]);
          setListId("");
          return;
        }
        setLists(body.lists ?? []);
        setListId("");
      } catch (e) {
        if (cancelled) return;
        setListsError(e instanceof Error ? e.message : String(e));
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
    Number(sprintPoints) > 0 &&
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
        sprint_points: Number(sprintPoints),
        is_internal: isInternal,
        goal: goal.trim(),
        success_criteria: successCriteria.trim(),
        measurable_outcome: measurableOutcome.trim(),
      };
      const { error } = await supabase
        // @ts-expect-error staff_briefs added by migration 0052
        .from("staff_briefs")
        .insert(insertPayload);
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      toast.success("Brief submitted for approval.");
      setTaskName("");
      setSprintPoints("1");
      setIsInternal(false);
      setGoal("");
      setSuccessCriteria("");
      setMeasurableOutcome("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="brief-client">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="brief-client">
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
          <Label htmlFor="brief-list">List / department</Label>
          <Select value={listId} onValueChange={setListId} disabled={!clientId}>
            <SelectTrigger id="brief-list">
              <SelectValue
                placeholder={
                  !clientId
                    ? "Pick a client first"
                    : loadingLists
                      ? "Loading lists…"
                      : lists.length === 0
                        ? "No lists found"
                        : "Pick a list"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {lists.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {listsError && <p className="text-body-small text-destructive">{listsError}</p>}
        </div>
      </div>

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
          <Label htmlFor="brief-sprint-points">Sprint points</Label>
          <Input
            id="brief-sprint-points"
            type="number"
            min={0.25}
            step={0.25}
            value={sprintPoints}
            onChange={(e) => setSprintPoints(e.target.value)}
          />
          <p className="text-label-small text-m-on-surface-variant">1 pt = 15 minutes</p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-m-outline-variant bg-m-surface px-4 py-3">
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
        <Label htmlFor="brief-measurable">What is the measurable outcome?</Label>
        <Textarea
          id="brief-measurable"
          value={measurableOutcome}
          onChange={(e) => setMeasurableOutcome(e.target.value)}
          placeholder="A number, a state change, an artefact."
          rows={3}
        />
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button type="submit" disabled={!canSubmit} className="gap-2">
          <Send className="h-4 w-4" />
          {submitting ? "Submitting…" : "Submit for approval"}
        </Button>
      </div>
    </form>
  );
}
