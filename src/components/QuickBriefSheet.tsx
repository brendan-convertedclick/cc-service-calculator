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
import { checklistFromSteps, NO_WORKFLOW, WorkflowSelect } from "@/components/systems/WorkflowSelect";
import { memberColors, useTeam } from "@/hooks/useTeam";
import { initials } from "@/components/systems/SystemBlockNode";
import { supabase } from "@/lib/supabase";
import { useDepartments } from "@/hooks/useDepartments";
import { useRetainers } from "@/hooks/useRetainers";
import { useSystemSteps } from "@/hooks/useProcessSteps";
import { useCreateQuickBriefTask } from "@/hooks/useCreateQuickBriefTask";
import { WAITING_STATUSES } from "@/hooks/useSignoffCandidates";
import { draftFromSuggestion, type QuickTaskSuggestion } from "@/lib/quick-brief-suggestion";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import { X } from "lucide-react";

const NO_PROJECT = "__none__";
const UNASSIGNED = "__unassigned__";
// "With the client" is not a person: the ClickUp task stays unassigned and
// carries the list's waiting-on-client status, which is the signal the client
// sign-off inbox already reads (useSignoffCandidates).
const CLIENT = "__client__";
const STATUS_DEFAULT = "__default__";

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
  /** The retainer this brief already sits against, if any — seeds the picker. */
  parent_project_id?: string | null;
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
  const memberColor = useMemo(() => memberColors(team), [team]);
  const { data: departments = [] } = useDepartments();
  const createTask = useCreateQuickBriefTask();
  // Which retainer this work belongs to. Until now the sheet asked whether the
  // work was retainer or adhoc but never which retainer — so "retainer" work
  // was created with no project behind it and never reached a burn figure.
  const { data: allRetainers = [] } = useRetainers();
  const clientRetainers = allRetainers.filter(
    (r) => r.status === "in_progress" && brief.client_id != null && r.client_id === brief.client_id,
  );
  const [projectId, setProjectId] = useState<string>(brief.parent_project_id ?? NO_PROJECT);

  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [measurableOutcome, setMeasurableOutcome] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [sprintPoints, setSprintPoints] = useState(1);
  const [workStream, setWorkStream] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [briefedBy, setBriefedBy] = useState<string>(UNASSIGNED);
  const [billingType, setBillingType] = useState<"retainer" | "adhoc">("retainer");
  const [checklistItems, setChecklistItems] = useState("");
  // Rows are a view over the same newline string — an empty value is one
  // empty row, which is the right starting state for a list you type into.
  const checklistLines = checklistItems.split("\n");
  const setChecklistLine = (i: number, value: string) =>
    setChecklistItems(checklistLines.map((l, n) => (n === i ? value : l)).join("\n"));
  const removeChecklistLine = (i: number) => {
    const next = checklistLines.filter((_, n) => n !== i);
    setChecklistItems(next.length ? next.join("\n") : "");
  };
  const [systemId, setSystemId] = useState<string>(NO_WORKFLOW);
  const [attachments, setAttachments] = useState<File[]>([]);
  // <input type="file"> is uncontrolled — bump this to force a remount (and
  // clear the displayed filenames) whenever the selection is reset.
  const [attachmentInputKey, setAttachmentInputKey] = useState(0);

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
    setSuccessCriteria("");
    setMeasurableOutcome("");
    setAssignee(brief.assignee_id ?? UNASSIGNED);
    setSprintPoints(draft.sprint_points);
    setWorkStream(draft.work_stream);
    setDueDate(draft.due_date ?? "");
    setBriefedBy(UNASSIGNED);
    setStatus(STATUS_DEFAULT);
    setBillingType(brief.billing_type === "adhoc" ? "adhoc" : "retainer");
    setChecklistItems("");
    setSystemId(NO_WORKFLOW);
    setAttachments([]);
    setAttachmentInputKey((k) => k + 1);
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
        const body = await callEdgeFn<{
          lists?: QuickBriefListOption[];
          work_stream_options?: QuickBriefWorkStreamOption[];
        }>("list-client-clickup-lists", { client_id: brief.client_id });
        if (cancelled) return;
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

  // Picking a workflow drops its process steps into the checklist box, where
  // they stay editable — the operator can trim or add before creating.
  const { data: systemSteps = [] } = useSystemSteps(
    systemId === NO_WORKFLOW ? undefined : systemId,
  );
  useEffect(() => {
    if (systemId === NO_WORKFLOW) return;
    setChecklistItems(checklistFromSteps(systemSteps));
  }, [systemId, systemSteps]);

  const selectedList = useMemo(() => lists.find((l) => l.id === listId), [lists, listId]);
  const waitingStatus = useMemo(
    () =>
      (selectedList?.statuses ?? []).find((s) =>
        (WAITING_STATUSES as readonly string[]).includes(s.status.toLowerCase()),
      )?.status ?? null,
    [selectedList],
  );
  // Picking Client forces the status rather than quietly diverging from it —
  // both fields on screen say the same thing.
  const effectiveStatus = assignee === CLIENT && waitingStatus ? waitingStatus : status;

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
      const extras = [
        successCriteria.trim() && `**What success looks like**\n${successCriteria.trim()}`,
        measurableOutcome.trim() && `**Expected output**\n${measurableOutcome.trim()}`,
      ].filter(Boolean) as string[];
      const composedDescription = [description.trim(), ...extras].filter(Boolean).join("\n\n");
      // The link lives on the brief, not on the ClickUp task — it is what makes
      // this work show up against the retainer.
      if (billingType === "retainer" && projectId !== NO_PROJECT && projectId !== brief.parent_project_id) {
        await supabase.from("briefs").update({ parent_project_id: projectId }).eq("id", brief.id);
      }
      const { clickup_task_url } = await createTask.mutateAsync({
        brief_id: brief.id,
        task_name: taskName.trim() || "Untitled task",
        description: composedDescription || undefined,
        assignee_member_id: assignee === UNASSIGNED || assignee === CLIENT ? null : assignee,
        sprint_points: Math.max(1, Math.round(sprintPoints)),
        work_stream: workStream,
        due_date: dueDate || null,
        list_id: listId || undefined,
        status: effectiveStatus === STATUS_DEFAULT ? undefined : effectiveStatus,
        briefed_by_member_id: briefedBy === UNASSIGNED ? null : briefedBy,
        billing_type: billingType,
        checklist_items: checklistItems.split("\n").filter((i) => i.trim()),
        // The steps were flattened into checklist text above, which loses where
        // they came from — send the id too so the task can carry the system's
        // reference docs (0129).
        system_id: systemId === NO_WORKFLOW ? null : systemId,
        attachments,
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
            <p className="rounded-lg border border-m-outline-variant bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
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
            <Input
              key={attachmentInputKey}
              id="qb-attachment"
              type="file"
              multiple
              className="max-w-xs"
              onChange={(e) => {
                setAttachments((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                // Reset so picking the same file again (after removing it) still fires onChange.
                setAttachmentInputKey((k) => k + 1);
              }}
            />
            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 text-body-small text-m-on-surface-variant">
                    <span className="truncate">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="qb-success">What does success look like?</Label>
            <Textarea
              id="qb-success"
              rows={2}
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              placeholder="Describe the finished state."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qb-measurable">What's the expected output, in numbers?</Label>
            <Textarea
              id="qb-measurable"
              rows={2}
              value={measurableOutcome}
              onChange={(e) => setMeasurableOutcome(e.target.value)}
              placeholder="e.g. 40 creatives, 1 Excel export, 3 landing pages — a count someone can check this against later."
            />
          </div>

          <WorkflowSelect id="qb-workflow" value={systemId} onValueChange={setSystemId} />

          {/* One row per item rather than a textarea of lines: this becomes a
              ClickUp checklist, so it should look like one while you write it
              — a blob of wrapped text hides where one item ends and the next
              begins. The boxes are for reading, not ticking; nothing is done
              until it's done in ClickUp. State stays a newline string so the
              submit and checklistFromSteps() are untouched. */}
          <div className="space-y-2">
            <Label htmlFor="qb-checklist-0">Checklist items</Label>
            <ul className="space-y-1.5">
              {checklistLines.map((line, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-4 w-4 flex-none rounded-[4px] border border-m-outline bg-m-surface"
                  />
                  <Input
                    id={`qb-checklist-${i}`}
                    value={line}
                    onChange={(e) => setChecklistLine(i, e.target.value)}
                    placeholder="What has to be done?"
                    className="h-9"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove checklist item ${i + 1}`}
                    disabled={checklistLines.length === 1 && !line}
                    onClick={() => removeChecklistLine(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setChecklistItems([...checklistLines, ""].join("\n"))}
            >
              Add item
            </Button>
            <p className="text-label-small text-m-on-surface-variant">
              Optional — becomes the checklist on the ClickUp task.
            </p>
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
                  <SelectItem value={CLIENT} disabled={!waitingStatus}>
                    Client
                  </SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <PersonOption name={m.full_name} color={memberColor.get(m.id)} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignee === CLIENT && waitingStatus && (
                <p className="text-label-small text-m-on-surface-variant">
                  Unassigned in ClickUp, status “{waitingStatus}” — it shows up in Client sign-offs.
                </p>
              )}
              {selectedList && !waitingStatus && (
                <p className="text-label-small text-m-on-surface-variant">
                  “Client” needs a waiting-on-client status on the selected list.
                </p>
              )}
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
                      <PersonOption name={m.full_name} color={memberColor.get(m.id)} />
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
              {hasClient && !loadingLists && workStreamOptions.length === 0 && (
                <p className="text-body-small text-amber-700">
                  Couldn't load ClickUp's real Work Stream options — showing Conductor's
                  department names instead, which don't all match. Close and reopen this
                  panel to retry, or double-check the field in ClickUp after creating.
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
              {billingType === "retainer" && (
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor="qb-project">Against which retainer</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger id="qb-project">
                      <SelectValue placeholder="Pick a retainer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PROJECT}>— not chosen</SelectItem>
                      {clientRetainers.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectId === NO_PROJECT && (
                    <p className="rounded-md bg-m-error-container px-2 py-1.5 text-label-small text-m-on-error-container">
                      {clientRetainers.length === 0
                        ? "This client has no live retainer. Bill it adhoc, or set the retainer up first — otherwise this work is delivered against nothing."
                        : "Retainer work with no retainer chosen is invisible: it never counts against a budget and never reaches an invoice."}
                    </p>
                  )}
                </div>
              )}
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
              <Select
                value={effectiveStatus}
                onValueChange={setStatus}
                disabled={!selectedList || assignee === CLIENT}
              >
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

// A name with the same coloured initial-circle the systems list uses, so one
// person reads the same wherever they appear. Rendered inside SelectItem, so
// the trigger shows it too once something is picked.
function PersonOption({ name, color }: { name: string; color: string | undefined }) {
  return (
    // min-w-0 + truncate on the name: the trigger renders this same markup,
    // and a long name would otherwise wrap and make the field taller than the
    // one beside it.
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ background: color }}
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
