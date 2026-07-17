import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateQuickBriefTask } from "@/hooks/useCreateQuickBriefTask";
import { draftFromSuggestion, type QuickTaskSuggestion } from "@/lib/quick-brief-suggestion";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";
const STATUS_DEFAULT = "__default__";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type QuickBriefListStatus = { status: string; color: string | null; type: string; orderindex: number };
type QuickBriefListOption = { id: string; name: string; statuses: QuickBriefListStatus[] };
type QuickBriefWorkStreamOption = { id: string; name: string };

export interface QuickBriefSheetBrief {
  id: string;
  client_id: string | null;
  intent_type: string | null;
  raw_subject: string | null;
  quick_task_suggestion: QuickTaskSuggestion | null;
  billing_type?: "retainer" | "adhoc" | null;
  /** Seeds the Assignee select so a pre-assigned brief doesn't open as Unassigned. */
  assignee_id?: string | null;
}

export interface QuickBriefSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brief: QuickBriefSheetBrief;
}

/**
 * Confirm sheet for briefing a quick task straight to ClickUp without scoping.
 * Prefilled from the AI's `quick_task_suggestion`; every field stays editable so
 * the operator can override before the task is created.
 */
export function QuickBriefSheet({ open, onOpenChange, brief }: QuickBriefSheetProps) {
  const { data: team = [] } = useTeam();
  const { data: departments = [] } = useDepartments();
  const createTask = useCreateQuickBriefTask();

  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [sprintPoints, setSprintPoints] = useState(1);
  const [workStream, setWorkStream] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [briefedBy, setBriefedBy] = useState<string>(UNASSIGNED);
  const [billingType, setBillingType] = useState<"retainer" | "adhoc">("retainer");

  const [lists, setLists] = useState<QuickBriefListOption[]>([]);
  const [workStreamOptions, setWorkStreamOptions] = useState<QuickBriefWorkStreamOption[]>([]);
  const [listId, setListId] = useState<string>("");
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(STATUS_DEFAULT);

  // Prefill each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const draft = draftFromSuggestion(brief.quick_task_suggestion, brief.raw_subject ?? "");
    setTaskName(draft.task_name);
    setDescription("");
    setAssignee(brief.assignee_id ?? UNASSIGNED);
    setSprintPoints(draft.sprint_points);
    setWorkStream(draft.work_stream);
    setDueDate(draft.due_date ?? "");
    setBriefedBy(UNASSIGNED);
    setStatus(STATUS_DEFAULT);
    setBillingType(brief.billing_type === "adhoc" ? "adhoc" : "retainer");
  }, [open, brief.quick_task_suggestion, brief.raw_subject, brief.billing_type, brief.assignee_id]);

  // Load the client's ClickUp lists + statuses when the sheet opens. Mirrors
  // the fetch pattern in BriefFormBody.tsx. Gated on `open` so a brief that's
  // never had its sheet opened never triggers a network call.
  useEffect(() => {
    if (!open || !brief.client_id) {
      setLists([]);
      setWorkStreamOptions([]);
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
          body: JSON.stringify({ client_id: brief.client_id }),
        });
        const body = (await res.json()) as {
          lists?: QuickBriefListOption[];
          work_stream_options?: QuickBriefWorkStreamOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setListsError(body.error ?? "Failed to load lists");
          setLists([]);
          setWorkStreamOptions([]);
          setListId("");
          return;
        }
        const fetchedLists = body.lists ?? [];
        setLists(fetchedLists);
        setWorkStreamOptions(body.work_stream_options ?? []);
        // Default to the "projects" list, mirroring the server's own fallback,
        // else the first list.
        const projectList = fetchedLists.find((l) => /project/i.test(l.name));
        setListId(projectList?.id ?? fetchedLists[0]?.id ?? "");
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
  }, [open, brief.client_id]);

  const selectedList = useMemo(() => lists.find((l) => l.id === listId), [lists, listId]);

  // The status set is scoped to whichever list is selected — reset to the
  // list default whenever the selected list changes.
  useEffect(() => {
    setStatus(STATUS_DEFAULT);
  }, [listId]);

  const hasClient = Boolean(brief.client_id);
  // The Work Stream picker must offer ClickUp's ACTUAL "Work Stream" custom-field
  // options (e.g. "Creative", "Content", "3D") — Conductor's department names
  // (e.g. "Creative Production") are a DIFFERENT label set and don't match, which
  // left the ClickUp field blank. RESILIENCE: if the ClickUp fetch failed (or
  // returned no options), fall back to `useDepartments()` so the operator is
  // never hard-blocked from creating a task.
  const workStreamSource = workStreamOptions.length > 0 ? workStreamOptions : departments;
  // A valid work stream must match one of the offered options — the AI's guess
  // can be empty or a stale/mismatched string that would otherwise flow straight
  // into the ClickUp "Work Stream" dropdown + BRIEF:: audit/invoice trail.
  const workStreamValid = workStreamSource.some((d) => d.name === workStream);
  const saving = createTask.isPending;

  const handleCreate = async () => {
    try {
      const { clickup_task_url } = await createTask.mutateAsync({
        brief_id: brief.id,
        task_name: taskName.trim() || "Untitled task",
        description: description.trim() || undefined,
        assignee_member_id: assignee === UNASSIGNED ? null : assignee,
        sprint_points: Math.max(1, Math.round(sprintPoints)),
        work_stream: workStream,
        due_date: dueDate || null,
        list_id: listId || undefined,
        status: status === STATUS_DEFAULT ? undefined : status,
        briefed_by_member_id: briefedBy === UNASSIGNED ? null : briefedBy,
        billing_type: billingType,
      });
      toast.success("Task created in ClickUp", {
        action: clickup_task_url
          ? { label: "Open", onClick: () => window.open(clickup_task_url, "_blank") }
          : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Brief as-is</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {!hasClient && (
            <p className="rounded-md border border-m-outline-variant bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
              Assign a client first.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="qb-task-name">Task name</Label>
            <Input
              id="qb-task-name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="What needs doing?"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qb-description">Task description</Label>
            <Textarea
              id="qb-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — left blank, the task carries the brief's text."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qb-assignee">Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="qb-assignee">
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
              <Label htmlFor="qb-briefed-by">Briefed by</Label>
              <Select value={briefedBy} onValueChange={setBriefedBy}>
                <SelectTrigger id="qb-briefed-by">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qb-points">Sprint points</Label>
              <Input
                id="qb-points"
                type="number"
                min={1}
                step={1}
                value={sprintPoints}
                onChange={(e) => setSprintPoints(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qb-due">Due date</Label>
              <Input
                id="qb-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qb-work-stream">Work stream</Label>
              <Select value={workStream} onValueChange={setWorkStream}>
                <SelectTrigger id="qb-work-stream">
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
              {!workStreamValid && (
                <p className="text-body-small text-m-on-surface-variant">
                  Pick a work stream — it sets the ClickUp dropdown and the invoice trail.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qb-billing">Billing</Label>
              <Select value={billingType} onValueChange={(v) => setBillingType(v as "retainer" | "adhoc")}>
                <SelectTrigger id="qb-billing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retainer">Retainer</SelectItem>
                  <SelectItem value="adhoc">Adhoc</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qb-list">List</Label>
              <Select value={listId} onValueChange={setListId} disabled={!hasClient || loadingLists}>
                <SelectTrigger id="qb-list">
                  <SelectValue
                    placeholder={
                      !hasClient
                        ? "Assign a client first"
                        : loadingLists
                          ? "Loading lists…"
                          : lists.length === 0
                            ? "Server will auto-pick"
                            : "Choose a list…"
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
                <p className="text-body-small text-destructive">
                  Couldn't load lists ({listsError}) — Create will still work, using the server's default list.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qb-status">Status</Label>
              <Select value={status} onValueChange={setStatus} disabled={!selectedList}>
                <SelectTrigger id="qb-status">
                  <SelectValue placeholder="— List default —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STATUS_DEFAULT}>— List default —</SelectItem>
                  {(selectedList?.statuses ?? []).map((s) => (
                    <SelectItem key={s.status} value={s.status}>
                      {s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !hasClient || !workStreamValid} onClick={handleCreate}>
              {saving ? "Creating…" : "Create task"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default QuickBriefSheet;
