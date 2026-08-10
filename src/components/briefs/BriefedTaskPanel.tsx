// src/components/briefs/BriefedTaskPanel.tsx
//
// Read-only detail view for a briefed brief's ClickUp task, with an inline
// edit mode. Shows how the brief was briefed (a tag), then the task's live
// fields. The parent's top-right "Edit task" button flips `editing` on; while
// editing, the ClickUp-synced fields (name / points / due date) become inputs
// with Save/Cancel. Client is also editable (a Conductor-only correction —
// same client_id patch as the "assign a client" picker on Scope.tsx; it does
// not touch ClickUp's own Client Name custom field). Billing stays read-only.

import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBriefedTaskDetails, useUpdateBriefedTask, useFlagClientDelay, type BriefedTaskFields } from "@/hooks/useBriefedTask";
import { useBriefExtensions, useResolveExtension, type BriefExtension } from "@/hooks/useBriefExtensions";
import { useTaskExtensionRequests } from "@/hooks/useTaskExtensionRequests";
import { ExtensionDialog } from "@/components/briefs/ExtensionDialog";
import { useClients } from "@/hooks/useClients";
import { useUpdateBrief } from "@/hooks/useBriefs";
import { useTeam } from "@/hooks/useTeam";
import { BILLING_LABEL, type BillingType } from "@/lib/brief-routing";
import { errorMessage } from "@/lib/utils";
import type { ExtensionRequestRow } from "@/types/extension-requests";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface BriefedTaskPanelProps {
  brief: {
    id: string;
    raw_subject: string | null;
    clickup_task_url: string | null;
    clickup_task_id: string | null;
    client_id: string | null;
    billing_type: string | null;
    assignee_id: string | null;
  };
  /** How the brief reached ClickUp, e.g. "Briefed as-is". */
  howBriefed: string;
  /** When true, the synced fields render as inputs. Controlled by the parent. */
  editing: boolean;
  /** Called after a successful save or a cancel, to leave edit mode. */
  onExitEdit: () => void;
}

/** "2026-07-23" → "23 Jul 2026" (or "—" when unset). */
function formatDue(due: string | null): string {
  if (!due) return "—";
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return due;
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-label-small uppercase tracking-wide text-m-on-surface-variant">{label}</div>
      <div className="text-body-medium text-m-on-surface">{children}</div>
    </div>
  );
}

export function BriefedTaskPanel({ brief, howBriefed, editing, onExitEdit }: BriefedTaskPanelProps) {
  const details = useBriefedTaskDetails(brief.id, true);
  const updateTask = useUpdateBriefedTask();
  const updateBrief = useUpdateBrief();
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { data: extensions = [] } = useBriefExtensions(brief.id, true);
  const { data: extensionRequests = [] } = useTaskExtensionRequests(brief.clickup_task_id, true);
  const [extensionOpen, setExtensionOpen] = useState(false);

  const clientName = clients.find((c) => c.id === brief.client_id)?.name ?? "—";
  const assigneeName = team.find((m) => m.id === brief.assignee_id)?.full_name ?? "Unassigned";
  const billingLabel = BILLING_LABEL[(brief.billing_type as BillingType) ?? "retainer"] ?? "Retainer";

  const UNASSIGNED = "__unassigned__";
  const [name, setName] = useState("");
  const [points, setPoints] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState(UNASSIGNED);
  const [clientId, setClientId] = useState("");

  // Re-seed the edit fields from the live task each time we enter edit mode.
  // Task name / points / due date come from ClickUp; assignee + client from
  // the brief.
  useEffect(() => {
    if (!editing || !details.data) return;
    setName(details.data.task_name ?? "");
    setPoints(details.data.sprint_points != null ? String(details.data.sprint_points) : "");
    setDueDate(details.data.due_date ?? "");
    setAssigneeId(brief.assignee_id ?? UNASSIGNED);
    setClientId(brief.client_id ?? "");
  }, [editing, details.data, brief.assignee_id, brief.client_id]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Task name can't be empty");
      return;
    }
    const parsedPoints = points.trim() === "" ? undefined : Number(points);
    if (parsedPoints !== undefined && (!Number.isFinite(parsedPoints) || parsedPoints < 0)) {
      toast.error("Sprint points must be a positive number");
      return;
    }
    const selectedAssignee = assigneeId === UNASSIGNED ? null : assigneeId;
    const assigneeChanged = selectedAssignee !== (brief.assignee_id ?? null);
    const clientChanged = clientId !== (brief.client_id ?? "");
    try {
      if (clientChanged) {
        // Conductor-only correction — same client_id patch as the "assign a
        // client" picker on Scope.tsx; doesn't touch ClickUp's own field.
        await updateBrief.mutateAsync({ id: brief.id, patch: { client_id: clientId || null } });
      }
      await updateTask.mutateAsync({
        brief_id: brief.id,
        task_name: trimmedName,
        sprint_points: parsedPoints,
        due_date: dueDate.trim() === "" ? null : dueDate,
        // Only send the assignee when it changed — reassigning hits ClickUp.
        ...(assigneeChanged ? { assignee_member_id: selectedAssignee } : {}),
      });
      toast.success("ClickUp task updated");
      onExitEdit();
    } catch (e) {
      toast.error(`Failed to update task: ${errorMessage(e)}`);
    }
  };

  const d = details.data;

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface p-6">
      {/* How-briefed tag + link out */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-m-outline-variant pb-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-label-small">{howBriefed}</Badge>
          <span className="text-body-small text-m-on-surface-variant">
            Pushed straight to ClickUp as a task — no scoping flow.
          </span>
        </div>
        <div className="flex items-center gap-3">
          {!editing && !details.isError && (
            <Button variant="outline" size="sm" onClick={() => setExtensionOpen(true)}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              Request extension
            </Button>
          )}
          {brief.clickup_task_url && (
            <a
              href={brief.clickup_task_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center whitespace-nowrap text-label-medium font-medium text-m-primary hover:underline"
            >
              View task in ClickUp
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      <ExtensionDialog
        brief={{ id: brief.id }}
        currentDueDate={d?.due_date ?? null}
        currentPoints={d?.sprint_points ?? null}
        open={extensionOpen}
        onOpenChange={setExtensionOpen}
      />

      {details.isLoading ? (
        <div className="py-8 text-center text-body-small text-m-on-surface-variant">
          Loading task from ClickUp…
        </div>
      ) : details.isError ? (
        <div className="py-6 text-center text-body-small text-destructive">
          {`Couldn't load the ClickUp task: ${errorMessage(details.error)}`}
        </div>
      ) : editing ? (
        // ── Edit mode: synced fields become inputs ────────────────────────────
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="bt-name">Task name</Label>
            <Input id="bt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name…" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bt-points">Sprint points</Label>
              <Input id="bt-points" type="number" min={0} step={1} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 2" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-due">Due date</Label>
              <Input id="bt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {/* Assignee reassigns the ClickUp task; client is a Conductor-only
              correction (see handleSave); billing stays read-only context set
              at brief time. */}
          <div className="grid grid-cols-1 gap-4 border-t border-m-outline-variant pt-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue />
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
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a client…" />
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
            <Field label="Billing">{billingLabel}</Field>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onExitEdit} disabled={updateTask.isPending || updateBrief.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateTask.isPending || updateBrief.isPending}>
              {updateTask.isPending || updateBrief.isPending ? "Saving…" : "Save to ClickUp"}
            </Button>
          </div>
        </div>
      ) : (
        // ── Read mode: all details, read-only ─────────────────────────────────
        <>
          <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <Field label="Task name">{d?.task_name || brief.raw_subject || "—"}</Field>
            </div>
            <Field label="Sprint points">{d?.sprint_points != null ? `${d.sprint_points} pts` : "—"}</Field>
            <Field label="Due date">{formatDue(d?.due_date ?? null)}</Field>
            <Field label="Assignee">{assigneeName}</Field>
            <Field label="Client">{clientName}</Field>
            <Field label="Billing">{billingLabel}</Field>
          </div>
          {d?.is_complete && <CompletionSection d={d} briefId={brief.id} />}
          <TaskHistory
            briefId={brief.id}
            briefedAt={d?.briefed_at ?? null}
            completedAt={d?.completed_at ?? null}
            extensions={extensions}
            extensionRequests={extensionRequests}
            team={team}
          />
        </>
      )}
    </div>
  );
}

/** What changed on a staff extension_requests row — points, due date, or both. */
function extensionRequestChange(e: ExtensionRequestRow): string {
  const pts = (v: number | null) => (v != null ? `${v} pt${v === 1 ? "" : "s"}` : "—");
  const parts: string[] = [];
  if (e.extra_points) parts.push(`${pts(e.original_points)} → ${pts((e.original_points ?? 0) + e.extra_points)}`);
  if (e.requested_due_date) parts.push(`due ${formatDue(e.original_due_date)} → ${formatDue(e.requested_due_date)}`);
  return parts.join(", ") || "extension";
}

/** Chronological history of the task: briefed → extensions → completed. */
function TaskHistory({
  briefId,
  briefedAt,
  completedAt,
  extensions,
  extensionRequests,
  team,
}: {
  briefId: string;
  briefedAt: string | null;
  completedAt: string | null;
  extensions: BriefExtension[];
  extensionRequests: ExtensionRequestRow[];
  team: TeamMember[];
}) {
  const resolve = useResolveExtension(briefId);
  const pts = (v: number | null) => (v != null ? `${v} pt${v === 1 ? "" : "s"}` : "—");
  const nameOf = (id: string | null) => team.find((m) => m.id === id)?.full_name ?? null;

  const extChange = (e: BriefExtension) => {
    const parts: string[] = [];
    if (e.new_due_date) parts.push(`due ${formatDue(e.prev_due_date)} → ${formatDue(e.new_due_date)}`);
    if (e.new_points != null) parts.push(`${pts(e.prev_points)} → ${pts(e.new_points)}`);
    return parts.join(", ") || "extension";
  };

  // Both sources are "an extension happened to this task", just raised through
  // different flows (client-approval vs staff admin/owner sign-off) — merged
  // into one chronological list rather than two separate sections.
  type TimelineItem =
    | { kind: "brief-extension"; at: string; row: BriefExtension }
    | { kind: "request-extension"; at: string; row: ExtensionRequestRow };
  const timeline: TimelineItem[] = [
    ...extensions.map((row): TimelineItem => ({ kind: "brief-extension", at: row.created_at, row })),
    ...extensionRequests.map((row): TimelineItem => ({
      kind: "request-extension",
      at: row.approved_at ?? row.admin_approved_at ?? row.created_at,
      row,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="mt-6 border-t border-m-outline-variant pt-5">
      <div className="mb-3 text-title-small text-m-on-surface">History</div>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-m-primary" />
          <div>
            <div className="text-body-small text-m-on-surface">Briefed into ClickUp</div>
            <div className="text-label-small text-m-on-surface-variant">{formatDue(briefedAt)}</div>
          </div>
        </li>

        {timeline.map((item) =>
          item.kind === "brief-extension" ? (
            <li key={`be-${item.row.id}`} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-small text-m-on-surface">Extension · {extChange(item.row)}</span>
                  {item.row.client_approval_status === "pending" && (
                    <Badge variant="warning" className="text-label-small">Pending client approval</Badge>
                  )}
                  {item.row.client_approval_status === "approved" && (
                    <Badge variant="success" className="text-label-small">Client approved</Badge>
                  )}
                  {item.row.client_approval_status === "declined" && (
                    <Badge variant="destructive" className="text-label-small">Client declined</Badge>
                  )}
                </div>
                <div className="text-label-small text-m-on-surface-variant">
                  {formatDue(item.row.created_at.slice(0, 10))} · {item.row.reason}
                </div>
                {item.row.client_approval_status === "pending" && (
                  <div className="mt-1.5 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve
                          .mutateAsync({ extension_id: item.row.id, action: "approve" })
                          .then(() => toast.success("Extra points applied"))
                          .catch((err) => toast.error(errorMessage(err)))
                      }
                    >
                      Client approved
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve
                          .mutateAsync({ extension_id: item.row.id, action: "decline" })
                          .then(() => toast.success("Extension declined"))
                          .catch((err) => toast.error(errorMessage(err)))
                      }
                    >
                      Declined
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ) : (
            <li key={`er-${item.row.id}`} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-small text-m-on-surface">
                    Extension request · {extensionRequestChange(item.row)}
                  </span>
                  <Badge variant="success" className="text-label-small">
                    {item.row.tier === "auto" ? "Auto-approved" : `Approved · ${item.row.tier}`}
                  </Badge>
                </div>
                <div className="text-label-small text-m-on-surface-variant">
                  {formatDue(item.at.slice(0, 10))}
                  {item.row.reason ? ` · ${item.row.reason}` : ""}
                  {item.row.due_date_reason && item.row.due_date_reason !== item.row.reason
                    ? ` · ${item.row.due_date_reason}`
                    : ""}
                  {(() => {
                    const approver = nameOf(item.row.approver_id) ?? nameOf(item.row.admin_approver_id);
                    return approver ? ` · approved by ${approver}` : "";
                  })()}
                </div>
              </div>
            </li>
          ),
        )}

        {completedAt && (
          <li className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <div>
              <div className="text-body-small text-m-on-surface">Completed</div>
              <div className="text-label-small text-m-on-surface-variant">{formatDue(completedAt)}</div>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

/** Estimated vs actual (points → hours) and due vs completed, once the task is done. */
function CompletionSection({ d, briefId }: { d: BriefedTaskFields; briefId: string }) {
  const flagDelay = useFlagClientDelay();
  const estHours = d.estimated_hours ?? null;
  const actHours = d.actual_hours ?? 0;
  const overBudget = estHours != null && actHours > estHours + 0.001;
  // Late is measured against the ORIGINAL committed due date, not the current
  // (possibly-extended) one — extensions don't silently reset accountability.
  const baselineDue = d.original_due_date ?? d.due_date ?? null;
  const late = daysLate(baselineDue, d.completed_at ?? null);
  const isLate = late != null && late > 0;
  const wasExtended = d.original_due_date != null && d.original_due_date !== d.due_date;

  // Two-clock split: our working time vs time the task sat waiting on the client.
  const clientWaitDays = d.client_wait_ms != null ? d.client_wait_ms / 86_400_000 : null;
  const turnaroundDays = daysLate(d.briefed_at ?? null, d.completed_at ?? null); // briefed → completed
  const ourTimeDays =
    turnaroundDays != null && clientWaitDays != null ? Math.max(0, turnaroundDays - clientWaitDays) : null;
  // A late close is client-caused when the overrun is covered by client-wait OR
  // the operator has manually flagged it as the client's fault.
  const manualFlag = !!d.client_delay_manual;
  const clientCausedLate =
    isLate && ((clientWaitDays != null && clientWaitDays >= (late ?? 0)) || manualFlag);

  const pts = (v: number | null | undefined) => (v != null ? `${v} pt${v === 1 ? "" : "s"}` : "—");
  const hrs = (v: number | null | undefined) => (v != null ? `${v}h` : "—");
  const fmtDays = (v: number | null) => (v != null ? `${Math.round(v * 10) / 10}d` : "—");

  return (
    <div className="mt-6 border-t border-m-outline-variant pt-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-title-small text-m-on-surface">Completion</div>
        {d.status_label && <Badge variant="secondary" className="text-label-small">{d.status_label}</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Sprint points / hours: estimated vs actual */}
        <div className="rounded-lg bg-m-surface-container-low p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Sprint points → hours</span>
            <Badge variant={overBudget ? "destructive" : "success"} className="text-label-small">
              {overBudget ? "Over budget" : "On budget"}
            </Badge>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <Field label="Est. (original)">{pts(d.estimated_points)} · {hrs(estHours)}</Field>
            <Field label="Actual">{pts(d.actual_points)} · {hrs(actHours)}</Field>
          </div>
        </div>
        {/* Due date vs completion date */}
        <div className="rounded-lg bg-m-surface-container-low p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-label-small uppercase tracking-wide text-m-on-surface-variant">Timeline</span>
            <div className="flex items-center gap-1.5">
              {isLate && (
                <Badge variant={clientCausedLate ? "warning" : "destructive"} className="text-label-small">
                  {clientCausedLate ? "Client delay" : "Internal"}
                </Badge>
              )}
              <Badge variant={isLate ? "destructive" : "success"} className="text-label-small">
                {isLate ? `Late by ${late} day${late === 1 ? "" : "s"}` : "On time"}
              </Badge>
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <Field label={wasExtended ? "Due (original)" : "Due"}>{formatDue(baselineDue)}</Field>
            <Field label="Completed">{formatDue(d.completed_at ?? null)}</Field>
          </div>
          {wasExtended && (
            <div className="mt-1.5 text-label-small text-m-on-surface-variant">
              Extended to {formatDue(d.due_date ?? null)}
            </div>
          )}
          {clientWaitDays != null && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-m-outline-variant pt-2 text-label-small text-m-on-surface-variant">
              <span>
                Our time <strong className="tabular-nums text-m-on-surface">{fmtDays(ourTimeDays)}</strong>
              </span>
              <span aria-hidden>·</span>
              <span>
                Waiting on client{" "}
                <strong className="tabular-nums text-amber-500">{fmtDays(clientWaitDays)}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Manual client-delay override — for slips the status flow didn't capture. */}
      {isLate && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-m-surface-container-low p-3">
          <span className="text-body-small text-m-on-surface-variant">
            {manualFlag
              ? "Flagged as a client-caused delay."
              : clientCausedLate
                ? "Auto-detected as client-caused (time waiting on client)."
                : "Counted as an internal delay."}
          </span>
          <Button
            variant={manualFlag ? "secondary" : "outline"}
            size="sm"
            disabled={flagDelay.isPending}
            onClick={() => {
              flagDelay.mutate(
                { brief_id: briefId, flagged: !manualFlag },
                {
                  onSuccess: () =>
                    toast.success(manualFlag ? "Client-delay flag removed" : "Flagged as client delay"),
                  onError: (e) => toast.error(`Couldn’t update flag: ${errorMessage(e)}`),
                },
              );
            }}
          >
            {manualFlag ? "Unflag client delay" : "Flag as client delay"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Whole days the completion date is past the due date (null if either is missing). */
function daysLate(due: string | null, completed: string | null): number | null {
  if (!due || !completed) return null;
  const d1 = new Date(`${due}T00:00:00`).getTime();
  const d2 = new Date(`${completed}T00:00:00`).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86_400_000);
}
