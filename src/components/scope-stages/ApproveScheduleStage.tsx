// Stage 5 of the brief flow: record the client's approval of the cost
// estimate, then schedule the confirmed team-task breakdown to ClickUp
// (one task per placement_task, via the schedule-brief-tasks edge function).

import { useMemo, useState } from "react";
import { CalendarCheck, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useBriefCE, useScheduleBriefTasks, useSetCEStatus } from "@/hooks/useBriefCE";
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

interface Props {
  briefId: string;
  /** brief.status — 'briefed' means scheduling already completed. */
  briefStatus: string;
}

export function ApproveScheduleStage({ briefId, briefStatus }: Props) {
  const userId = useCurrentUserId();
  const { data: ce } = useBriefCE(briefId);
  const { data: placements } = useScopeMapPlacements(briefId);
  const { data: allTasks } = useLineTasks(briefId);
  const setStatus = useSetCEStatus(briefId);
  const schedule = useScheduleBriefTasks(briefId);

  const [approveNote, setApproveNote] = useState("");
  const [showApprove, setShowApprove] = useState(false);

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
  const scheduled = briefStatus === "briefed" || (teamTasks.length > 0 && unpushed.length === 0);

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
      .catch((e) => toast.error(e instanceof Error ? e.message : "Update failed"));

  const runSchedule = () =>
    schedule
      .mutateAsync({ briefed_by_member_id: userId })
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
      .catch((e) => toast.error(e instanceof Error ? e.message : "Scheduling failed"));

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
          <Card>
            <CardContent className="divide-y divide-m-outline-variant p-0">
              {teamTasks.length === 0 && (
                <p className="px-4 py-3 text-body-small text-m-on-surface-variant">
                  No team tasks on the billable lines — add them on the scope receipt
                  (Stage 1) before scheduling.
                </p>
              )}
              {teamTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-body-medium">{t.title}</p>
                    <p className="text-label-small text-m-on-surface-variant">{t.lineName}</p>
                  </div>
                  <span className="shrink-0 font-mono tabular-nums text-label-small text-m-on-surface-variant">
                    {t.points} pt
                  </span>
                  {t.clickup_task_url ? (
                    <Button variant="ghost" size="sm" asChild className="gap-1 text-m-primary">
                      <a href={t.clickup_task_url} target="_blank" rel="noreferrer">
                        In ClickUp
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="muted">Not scheduled</Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          {scheduled ? (
            <p className="flex items-center gap-1.5 text-body-small text-m-primary">
              <CalendarCheck className="h-4 w-4" />
              All team tasks are scheduled — the brief is with the team.
            </p>
          ) : (
            <div className="flex justify-end">
              <Button
                className="gap-2"
                disabled={schedule.isPending || unpushed.length === 0}
                onClick={runSchedule}
              >
                <CalendarCheck className="h-4 w-4" />
                {schedule.isPending
                  ? "Scheduling…"
                  : `Schedule ${unpushed.length} task${unpushed.length === 1 ? "" : "s"} to the team`}
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
