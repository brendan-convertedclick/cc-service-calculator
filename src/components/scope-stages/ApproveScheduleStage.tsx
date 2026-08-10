// Stage 5 of the brief flow: record the client's approval of the cost
// estimate, then schedule the confirmed team-task breakdown to ClickUp
// (one task per placement_task, via the schedule-brief-tasks edge function).

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Check, ChevronDown, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";
import { callEdgeFn } from "@/lib/edge";
import {
  useBriefCE,
  useScheduleBriefTasks,
  useSetCEStatus,
  type ScheduleTaskOverride,
} from "@/hooks/useBriefCE";
import { useBrief } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { useLineTasks } from "@/hooks/usePlacementTasks";
import { useScopeMapPlacements } from "@/hooks/useScopeMap";
import { useCurrentUserId } from "@/context/AuthContext";
import { isBillablePlacement } from "@/types/sow-placements";
import type { CEStatus } from "@/types/change-estimates";

const STEPS: Array<{ key: CEStatus; label: string }> = [
  { key: "draft", label: "Drafted" },
  { key: "sent", label: "Sent to client" },
  { key: "approved", label: "Approved" },
];
const STEP_RANK: Partial<Record<CEStatus, number>> = { draft: 0, sent: 1, approved: 2 };

/** Editable ClickUp payload for one task — seeded from the same defaults the
 *  schedule-brief-tasks edge function would compose, then sent as overrides. */
type TaskEdit = {
  name: string;
  description: string;
  workStream: string;
  points: string;
  /** team_members.clickup_user_id as string; "" = unassigned. */
  assignee: string;
  /** YYYY-MM-DD; "" = no due date. */
  dueDate: string;
};

const UNASSIGNED = "unassigned";
const STATUS_DEFAULT = "__default__";

type ListOption = {
  id: string;
  name: string;
  statuses: Array<{ status: string }>;
};

interface Props {
  briefId: string;
  /** brief.status — 'briefed' means scheduling already completed. */
  briefStatus: string;
}

export function ApproveScheduleStage({ briefId, briefStatus }: Props) {
  const userId = useCurrentUserId();
  const { data: ce } = useBriefCE(briefId);
  const { data: brief } = useBrief(briefId);
  const { data: clients } = useClients();
  const { data: departments } = useDepartments();
  const { data: team } = useTeam();
  const { data: placements } = useScopeMapPlacements(briefId);
  const { data: allTasks } = useLineTasks(briefId);
  const setStatus = useSetCEStatus(briefId);
  const schedule = useScheduleBriefTasks(briefId);

  const [approveNote, setApproveNote] = useState("");
  const [showApprove, setShowApprove] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Ticked by default: track the UNticked set so new tasks arrive confirmed.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, TaskEdit>>({});

  // Destination: the client's ClickUp lists + per-list statuses, chosen here
  // (mirrors the Brief-as-is sheet) instead of the server guessing a list.
  const [listOptions, setListOptions] = useState<ListOption[]>([]);
  const [listId, setListId] = useState("");
  const [cuStatus, setCuStatus] = useState(STATUS_DEFAULT);
  const [listsError, setListsError] = useState<string | null>(null);

  useEffect(() => {
    if (!brief?.client_id) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await callEdgeFn<{ lists?: ListOption[] }>("list-client-clickup-lists", {
          client_id: brief.client_id,
        });
        if (cancelled) return;
        const fetched = body.lists ?? [];
        setListOptions(fetched);
        // Same default the server falls back to: the "projects" list, else first.
        const projectList = fetched.find((l) => /project/i.test(l.name));
        setListId((cur) => cur || (projectList?.id ?? fetched[0]?.id ?? ""));
      } catch (e) {
        if (!cancelled) setListsError(`Failed to load ClickUp lists: ${errorMessage(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brief?.client_id]);

  const selectedList = useMemo(
    () => listOptions.find((l) => l.id === listId),
    [listOptions, listId],
  );
  // Statuses are per-list — reset to the list default when the list changes.
  useEffect(() => {
    setCuStatus(STATUS_DEFAULT);
  }, [listId]);

  const client = useMemo(
    () => (clients ?? []).find((c) => c.id === brief?.client_id) ?? null,
    [clients, brief?.client_id],
  );
  const deptById = useMemo(
    () => new Map((departments ?? []).map((d) => [d.id, d])),
    [departments],
  );
  const workStreamOptions = useMemo(() => {
    const set = new Set<string>(["Ad-hoc"]);
    for (const d of departments ?? []) set.add(d.clickup_work_stream ?? d.name);
    return [...set].sort();
  }, [departments]);
  const assignableMembers = useMemo(
    () => (team ?? []).filter((m) => m.clickup_user_id != null),
    [team],
  );

  // Team tasks under billable lines — what "Schedule" will push.
  const teamTasks = useMemo(() => {
    const billableIds = new Set(
      (placements ?? []).filter(isBillablePlacement).map((p) => p.id),
    );
    const nameByPlacement = new Map(
      (placements ?? []).map((p) => [p.id, p.item_name ?? p.task_ref]),
    );
    return (allTasks ?? [])
      .filter((t) => billableIds.has(t.placement_id) && t.title.trim() !== "")
      .map((t) => ({ ...t, lineName: nameByPlacement.get(t.placement_id) ?? "Deliverable" }));
  }, [allTasks, placements]);

  const unpushed = teamTasks.filter((t) => !t.clickup_task_id);
  const confirmed = unpushed.filter((t) => !deselected.has(t.id));
  const missingDueCount = confirmed.filter((t) => !(edits[t.id]?.dueDate ?? "")).length;
  const scheduled = briefStatus === "briefed" || (teamTasks.length > 0 && unpushed.length === 0);

  type TeamTask = (typeof teamTasks)[number];

  // Mirrors the defaults schedule-brief-tasks composes server-side, so the
  // preview IS the payload (the fn appends its audit stamp to the description).
  const defaultEdit = (t: TeamTask): TaskEdit => {
    const dept = t.department_id ? deptById.get(t.department_id) : null;
    // Default assignee: the department's primary team member (if they're
    // linked to a ClickUp user).
    const primary = dept?.primary_team_member_id
      ? assignableMembers.find((m) => m.id === dept.primary_team_member_id)
      : null;
    return {
      name: `${t.lineName} — ${t.title}`,
      description: `${t.title}\n\nDeliverable: ${t.lineName}\nBrief: ${brief?.raw_subject ?? briefId}`,
      workStream: dept ? (dept.clickup_work_stream ?? dept.name) : "Ad-hoc",
      points: String(Math.max(1, Math.round(Number(t.points) || 1))),
      assignee: primary ? String(primary.clickup_user_id) : "",
      dueDate: "",
    };
  };
  const editFor = (t: TeamTask): TaskEdit => edits[t.id] ?? defaultEdit(t);
  const patchEdit = (t: TeamTask, patch: Partial<TaskEdit>) =>
    setEdits((prev) => ({ ...prev, [t.id]: { ...(prev[t.id] ?? defaultEdit(t)), ...patch } }));
  const toggleExpanded = (id: string) => setExpanded((prev) => toggleInSet(prev, id));

  if (!ce) {
    return (
      <p className="text-body-small text-m-on-surface-variant">
        Create the cost estimate in the previous step first.
      </p>
    );
  }

  const rank = STEP_RANK[ce.status] ?? -1;

  const mark = (status: CEStatus, note?: string) =>
    setStatus
      .mutateAsync({ ceId: ce.id, status, note })
      .then(() => toast.success(`Estimate marked ${status}.`))
      .catch((e) => toast.error(`Update failed: ${errorMessage(e)}`));

  const runSchedule = () =>
    schedule
      .mutateAsync({
        briefed_by_member_id: userId,
        list_id: listId || null,
        status: cuStatus === STATUS_DEFAULT ? null : cuStatus,
        // Only confirmed (ticked) tasks — the list doubles as the selection.
        tasks: confirmed.map((t): ScheduleTaskOverride => {
          const e = editFor(t);
          return {
            placement_task_id: t.id,
            name: e.name.trim() || undefined,
            description: e.description.trim() || undefined,
            work_stream: e.workStream || undefined,
            points: Number(e.points) > 0 ? Number(e.points) : undefined,
            assignee_clickup_id: e.assignee ? Number(e.assignee) : null,
            due_date: e.dueDate || null,
          };
        }),
      })
      .then((res) => {
        const failed = res.failures?.length ?? 0;
        if (failed > 0) {
          toast.warning(
            `${res.created.length} task(s) scheduled, ${failed} failed — re-run to retry the rest.`,
          );
        } else {
          toast.success(
            `${res.created.length} task(s) scheduled to ClickUp${res.list_name ? ` (${res.list_name})` : ""}.`,
          );
        }
      })
      .catch((e) => toast.error(`Scheduling failed: ${errorMessage(e)}`));

  return (
    <div className="space-y-4">
      {/* Approval pipeline */}
      <div className="flex items-center gap-2" role="list" aria-label="Estimate approval steps">
        {STEPS.map((s, i) => {
          const reached = ce.status === "rejected" ? i === 0 : rank >= i;
          return (
            <div key={s.key} role="listitem" className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-m-outline-variant" aria-hidden />}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label-medium",
                  reached
                    ? "bg-m-primary-container text-m-on-primary-container"
                    : "bg-m-surface-container text-m-on-surface-variant",
                )}
              >
                {reached && <Check className="h-3.5 w-3.5" />}
                {s.label}
              </span>
            </div>
          );
        })}
        {ce.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
      </div>

      {/* Draft → sent (fallback for out-of-band sends; the composer does this on send) */}
      {ce.status === "draft" && (
        <div className="flex items-center gap-3">
          <p className="text-body-small text-m-on-surface-variant">
            Send the estimate from the previous step — or, if it went out another way:
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => mark("sent")}
          >
            Mark as sent
          </Button>
        </div>
      )}

      {/* Sent → approved / rejected */}
      {ce.status === "sent" && (
        <div className="space-y-2">
          {showApprove ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                placeholder="Approval note (optional) — who approved, and where?"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowApprove(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    mark("approved", approveNote.trim() || undefined).then(() =>
                      setShowApprove(false),
                    )
                  }
                >
                  Confirm approval
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setShowApprove(true)}>
                <Check className="h-4 w-4" />
                Client approved
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={setStatus.isPending}
                onClick={() => mark("rejected")}
              >
                <X className="h-4 w-4" />
                Rejected
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Approved → schedule */}
      {ce.status === "approved" && (
        <div className="space-y-3">
          {unpushed.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-64 space-y-1.5">
                <Label>ClickUp list</Label>
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger aria-label="ClickUp list">
                    <SelectValue placeholder="Choose a list…" />
                  </SelectTrigger>
                  <SelectContent>
                    {listOptions.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48 space-y-1.5">
                <Label>Status</Label>
                <Select value={cuStatus} onValueChange={setCuStatus}>
                  <SelectTrigger aria-label="Status">
                    <SelectValue />
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
              {listsError && (
                <p className="text-label-small text-m-error">{listsError}</p>
              )}
            </div>
          )}
          <Card>
            <CardContent className="divide-y divide-m-outline-variant p-0">
              {teamTasks.length === 0 && (
                <p className="px-4 py-3 text-body-small text-m-on-surface-variant">
                  No team tasks on the billable lines — add them on the scope receipt
                  (Stage 1) before scheduling.
                </p>
              )}
              {teamTasks.map((t) => {
                const pushed = !!t.clickup_task_id;
                const included = !deselected.has(t.id);
                const isOpen = expanded.has(t.id);
                const e = editFor(t);
                const assigneeName = e.assignee
                  ? assignableMembers.find((m) => String(m.clickup_user_id) === e.assignee)
                      ?.full_name
                  : null;
                return (
                  <div key={t.id}>
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      {!pushed && (
                        <Checkbox
                          checked={included}
                          aria-label={`Schedule "${e.name}"`}
                          onCheckedChange={(checked) =>
                            setDeselected((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                        />
                      )}
                      <div
                        className={cn(
                          "min-w-0 flex-1",
                          !pushed && !included && "opacity-50",
                        )}
                      >
                        <p className="break-words text-body-medium">{e.name}</p>
                        <p className="text-label-small text-m-on-surface-variant">
                          {e.workStream}
                          {assigneeName ? ` · ${assigneeName}` : " · Unassigned"}
                          {e.dueDate ? (
                            ` · due ${e.dueDate}`
                          ) : included ? (
                            <span className="text-destructive"> · due date needed</span>
                          ) : (
                            ""
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono tabular-nums text-label-small text-m-on-surface-variant">
                        {e.points} pt
                      </span>
                      {pushed ? (
                        <Button variant="ghost" size="sm" asChild className="gap-1 text-m-primary">
                          <a href={t.clickup_task_url!} target="_blank" rel="noreferrer">
                            In ClickUp
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      ) : (
                        <Badge variant="muted">{included ? "Not scheduled" : "Left out"}</Badge>
                      )}
                      {!pushed && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={isOpen ? "Hide ClickUp details" : "Show ClickUp details"}
                          aria-expanded={isOpen}
                          onClick={() => toggleExpanded(t.id)}
                        >
                          <ChevronDown
                            className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                          />
                        </Button>
                      )}
                    </div>
                    {!pushed && isOpen && (
                      <div className="space-y-3 border-t border-m-outline-variant bg-m-surface-container-low px-4 py-3">
                        <p className="text-label-small text-m-on-surface-variant">
                          Everything below is sent to ClickUp when you schedule — edit as needed.
                        </p>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cu-name-${t.id}`}>Task title</Label>
                          <Input
                            id={`cu-name-${t.id}`}
                            value={e.name}
                            onChange={(ev) => patchEdit(t, { name: ev.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`cu-desc-${t.id}`}>Description</Label>
                          <Textarea
                            id={`cu-desc-${t.id}`}
                            rows={4}
                            value={e.description}
                            onChange={(ev) => patchEdit(t, { description: ev.target.value })}
                          />
                          <p className="text-label-small text-m-on-surface-variant">
                            An audit line (cost estimate + date) is appended automatically.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Assignee</Label>
                            <Select
                              value={e.assignee || UNASSIGNED}
                              onValueChange={(v) =>
                                patchEdit(t, { assignee: v === UNASSIGNED ? "" : v })
                              }
                            >
                              <SelectTrigger aria-label="Assignee">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                {assignableMembers.map((m) => (
                                  <SelectItem key={m.id} value={String(m.clickup_user_id)}>
                                    {m.full_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`cu-due-${t.id}`}>
                              Due date <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id={`cu-due-${t.id}`}
                              type="date"
                              required
                              aria-invalid={!e.dueDate}
                              value={e.dueDate}
                              className={cn(!e.dueDate && "border-destructive")}
                              onChange={(ev) => patchEdit(t, { dueDate: ev.target.value })}
                            />
                            {!e.dueDate && (
                              <p className="text-label-small text-destructive">
                                Required before scheduling
                              </p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label>Work stream</Label>
                            <Select
                              value={e.workStream}
                              onValueChange={(v) => patchEdit(t, { workStream: v })}
                            >
                              <SelectTrigger aria-label="Work stream">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {workStreamOptions.map((w) => (
                                  <SelectItem key={w} value={w}>
                                    {w}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`cu-pts-${t.id}`}>Sprint points</Label>
                            <Input
                              id={`cu-pts-${t.id}`}
                              type="number"
                              min={1}
                              step={1}
                              value={e.points}
                              onChange={(ev) => patchEdit(t, { points: ev.target.value })}
                            />
                            <p className="text-label-small text-m-on-surface-variant">
                              1 pt = 15 min · time estimate{" "}
                              {(() => {
                                const mins = Math.max(1, Math.round(Number(e.points) || 1)) * 15;
                                return mins >= 60
                                  ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`
                                  : `${mins}m`;
                              })()}
                            </p>
                          </div>
                        </div>
                        <dl className="grid gap-x-6 gap-y-1 text-body-small sm:grid-cols-2">
                          {(
                            [
                              ["Client", client?.clickup_client_name ?? client?.name ?? "—"],
                              ["Engagement type", "Task"],
                              ["Date of engagement", "Set to the day you schedule"],
                              ["List", selectedList?.name ?? "Choose above"],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k} className="flex items-baseline justify-between gap-3">
                              <dt className="text-m-on-surface-variant">{k}</dt>
                              <dd className="text-right">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {scheduled && unpushed.length === 0 ? (
            <p className="flex items-center gap-1.5 text-body-small text-m-primary">
              <CalendarCheck className="h-4 w-4" />
              All team tasks are scheduled — the brief is with the team.
            </p>
          ) : (
            <div className="flex items-center justify-end gap-3">
              {missingDueCount > 0 ? (
                <p className="text-label-small text-destructive">
                  Set a due date on {missingDueCount} task{missingDueCount === 1 ? "" : "s"} first
                </p>
              ) : (
                unpushed.length > confirmed.length && (
                  <p className="text-label-small text-m-on-surface-variant">
                    {unpushed.length - confirmed.length} unticked task
                    {unpushed.length - confirmed.length === 1 ? "" : "s"} will be left out
                  </p>
                )
              )}
              <Button
                className="gap-2"
                disabled={schedule.isPending || confirmed.length === 0 || missingDueCount > 0}
                onClick={runSchedule}
              >
                <CalendarCheck className="h-4 w-4" />
                {schedule.isPending
                  ? "Scheduling…"
                  : `Schedule ${confirmed.length} task${confirmed.length === 1 ? "" : "s"} to the team`}
              </Button>
            </div>
          )}
        </div>
      )}

      {ce.status === "rejected" && (
        <p className="text-body-small text-destructive">
          The client rejected this estimate{ce.rejected_reason ? ` — ${ce.rejected_reason}` : ""}.
          Adjust the scope or the estimate and re-send.
        </p>
      )}
    </div>
  );
}
