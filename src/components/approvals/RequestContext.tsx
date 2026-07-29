import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type TaskContext = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  status: string | null;
  list_name: string | null;
  assignees: string[];
  due_date: number | null;
  date_created: number | null;
  original_points: number | null;
  time_estimate_ms: number | null;
  time_spent_ms: number;
  points_consumed: number;
};

function fmtHours(ms: number | null): string {
  if (ms === null) return "—";
  const h = ms / 3_600_000;
  return h >= 1 ? `${Math.round(h * 10) / 10}h` : `${Math.round(ms / 60_000)}m`;
}

function fmtDate(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleDateString();
}

/**
 * The original context behind an extension/revision request: what the task
 * asked for, what it was budgeted at, and how much has already been burned
 * against it. Read live from ClickUp so it also works for requests raised
 * before this panel existed.
 */
export function RequestContext({
  taskId,
  requestedPoints,
}: {
  taskId: string;
  requestedPoints?: number | null;
}) {
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorPoints, setPriorPoints] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`${FUNCTIONS_BASE}/get-clickup-task-context`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ task_id: taskId }),
        });
        const body = (await res.json()) as { context?: TaskContext; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.context) {
          setError(body.error ?? "Could not load task context");
          return;
        }
        setCtx(body.context);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Time tracked on the parent doesn't roll up subtask time, so a task that
  // has already been extended reads as under-consumed without this.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("extension_requests")
        .select("extra_points")
        .eq("parent_clickup_task_id", taskId)
        .in("status", ["approved", "auto_approved"]);
      if (cancelled) return;
      const rows = (data ?? []) as { extra_points: number | null }[];
      setPriorPoints(rows.reduce((sum, r) => sum + Number(r.extra_points ?? 0), 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error) {
    return (
      <div className="rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-3 text-body-small text-m-on-surface-variant">
        Original context unavailable: {error}
      </div>
    );
  }
  if (!ctx) return <Skeleton className="h-32 w-full" />;

  const budgetPoints = ctx.original_points;
  const overBudget = budgetPoints !== null && budgetPoints > 0
    ? Math.round((ctx.points_consumed / budgetPoints) * 100)
    : null;
  // What the budget becomes if this request is approved.
  const afterPoints =
    budgetPoints !== null && requestedPoints ? budgetPoints + requestedPoints : null;

  return (
    <div className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-label-large text-m-on-surface-variant">Original task</h4>
        <a
          href={ctx.url}
          target="_blank"
          rel="noreferrer"
          className="text-label-small text-m-primary inline-flex items-center gap-1 hover:underline"
        >
          Open in ClickUp <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-body-small sm:grid-cols-4">
        <Stat label="Budget">
          {budgetPoints !== null ? `${budgetPoints} pt` : "no points set"}
          <span className="text-m-on-surface-variant"> · {fmtHours(ctx.time_estimate_ms)}</span>
        </Stat>
        <Stat label="Time spent">
          {fmtHours(ctx.time_spent_ms)}
          <span className="text-m-on-surface-variant"> · {ctx.points_consumed} pt used</span>
        </Stat>
        <Stat label="Consumed">
          {overBudget === null ? (
            "—"
          ) : (
            <Badge variant={overBudget > 100 ? "destructive" : overBudget > 75 ? "warning" : "muted"}>
              {overBudget}% of budget
            </Badge>
          )}
        </Stat>
        <Stat label="Due">{fmtDate(ctx.due_date)}</Stat>

        <Stat label="Status">{ctx.status ?? "—"}</Stat>
        <Stat label="List">{ctx.list_name ?? "—"}</Stat>
        <Stat label="Assigned">{ctx.assignees.join(", ") || "—"}</Stat>
        <Stat label="Created">{fmtDate(ctx.date_created)}</Stat>
      </dl>

      {(priorPoints > 0 || afterPoints !== null) && (
        <div className="flex flex-wrap items-center gap-2 text-body-small">
          {priorPoints > 0 && (
            <Badge variant="warning">
              already extended by +{priorPoints}pt (not in the time above)
            </Badge>
          )}
          {afterPoints !== null && (
            <span className="text-m-on-surface-variant">
              Budget if approved: <span className="text-m-on-surface">{afterPoints} pt</span>
            </span>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-label-small text-m-on-surface-variant">Original brief</div>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-body-small text-m-on-surface">
          {ctx.description ?? "No description on the ClickUp task."}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-label-small text-m-on-surface-variant">{label}</dt>
      <dd className="text-body-small text-m-on-surface">{children}</dd>
    </div>
  );
}
