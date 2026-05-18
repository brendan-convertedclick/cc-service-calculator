import { useEffect, useMemo, useState } from "react";
import { Calculator, LogOut, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
 * Phase 1 — Staff-authored brief form.
 *
 * The single page that staff-role users see when they log in. No nav, no
 * sidebar, no other routes accessible. Submits a row to staff_briefs with
 * status='pending_approval'; admins approve via the /approvals queue.
 */
export function StaffBriefForm() {
  const { user, currentUserId, signOut } = useAuth();
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

  // Load clients once.
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

  // Load lists when client changes.
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
        // @ts-expect-error staff_briefs added by migration 0052; db.ts will regenerate
        .from("staff_briefs")
        .insert(insertPayload);
      if (error) {
        toast.error(`Submit failed: ${error.message}`);
        return;
      }
      toast.success("Brief submitted for approval.");
      // Reset for the next entry; keep client + list to speed up consecutive briefs.
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
    <div className="relative min-h-screen overflow-hidden bg-m-surface-container-low">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 10%, hsl(var(--mcolor-primary-container)) 0%, transparent 60%), " +
            "radial-gradient(50% 40% at 80% 90%, hsl(var(--mcolor-tertiary-container)) 0%, transparent 60%)",
        }}
      />
      <header className="flex items-center justify-between border-b border-m-outline-variant/40 bg-m-surface/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container">
            <Calculator className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-title-small text-m-on-surface">Converted Click</div>
            <div className="text-label-small text-m-on-surface-variant">Brief a task</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-body-small text-m-on-surface">{user?.email}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card className="shadow-elev-2">
          <CardHeader>
            <CardTitle className="text-headline-small">New brief</CardTitle>
            <CardDescription>
              Every task you work on starts here. Once approved, it shows up in ClickUp
              assigned to you with the budget and context you set below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="client">Client</Label>
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger id="client">
                      <SelectValue placeholder="Pick a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="list">List / department</Label>
                  <Select value={listId} onValueChange={setListId} disabled={!clientId}>
                    <SelectTrigger id="list">
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
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {listsError && (
                    <p className="text-body-small text-destructive">{listsError}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr,140px]">
                <div className="space-y-2">
                  <Label htmlFor="task-name">Task name</Label>
                  <Input
                    id="task-name"
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value)}
                    placeholder="Short, specific, action-oriented"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sprint-points">Sprint points</Label>
                  <Input
                    id="sprint-points"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={sprintPoints}
                    onChange={(e) => setSprintPoints(e.target.value)}
                  />
                  <p className="text-label-small text-m-on-surface-variant">
                    1 pt = 15 minutes
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-m-outline-variant bg-m-surface px-4 py-3">
                <div>
                  <Label htmlFor="is-internal" className="text-body-medium text-m-on-surface">
                    Internal project
                  </Label>
                  <p className="text-label-small text-m-on-surface-variant">
                    Off = client work · On = internal initiative
                  </p>
                </div>
                <Switch id="is-internal" checked={isInternal} onCheckedChange={setIsInternal} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="goal">What do you want to achieve?</Label>
                <Textarea
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="The outcome you're aiming for."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="success">What does success look like?</Label>
                <Textarea
                  id="success"
                  value={successCriteria}
                  onChange={(e) => setSuccessCriteria(e.target.value)}
                  placeholder="Describe the finished state. What would a teammate see?"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="measurable">What is the measurable outcome?</Label>
                <Textarea
                  id="measurable"
                  value={measurableOutcome}
                  onChange={(e) => setMeasurableOutcome(e.target.value)}
                  placeholder="A number, a state change, an artefact. Be specific."
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
