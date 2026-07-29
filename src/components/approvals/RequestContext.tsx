import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { pointsToHours } from "@/lib/sprint-points";
import { aggregateBurn, useRequestLinkage } from "@/hooks/useRequestLinkage";

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

/**
 * Points are the unit people brief and argue in; hours are the unit they feel.
 * Both are always shown, points first — 1 pt = 15 min (see lib/sprint-points).
 */
function fmtPoints(pts: number | null): string {
  if (pts === null) return "—";
  return `${pts} pt · ${fmtHours(pointsToHours(pts) * 3_600_000)}`;
}

function fmtDate(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleDateString("en-ZA");
}

/**
 * Figures are set in mono with tabular figures so they line up column to column
 * and read as exact — the same treatment money gets elsewhere in the app.
 */
function Fig({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

/**
 * This panel sits inside a Card on both approval queues, so it separates
 * tonally rather than with its own border — the design system bans nesting a
 * bordered surface inside a bordered surface.
 */
const PANEL = "rounded-md bg-m-surface-container-low px-4 py-3";

// ClickUp descriptions are markdown. We don't render markdown here — only the
// links matter, because that's where the task's Conductor origin lives.
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Drop the markdown that would otherwise show as literal `* * *` / `_x_`. */
function plainish(text: string): string {
  return text
    .replace(/^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*-{3,}[ \t]*$/gm, "—")
    .replace(/_([^_\n]+)_/g, "$1");
}

function withLinks(raw: string): React.ReactNode[] {
  const text = plainish(raw);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={at}
        href={m[2]}
        target="_blank"
        rel="noreferrer"
        className="text-m-primary hover:underline"
      >
        {m[1].replace(/[_*]/g, "")}
      </a>,
    );
    last = at + m[0].length;
  }
  out.push(text.slice(last));
  return out;
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
  clientId,
}: {
  taskId: string;
  requestedPoints?: number | null;
  clientId?: string | null;
}) {
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorPoints, setPriorPoints] = useState<number>(0);
  const { data: linkage } = useRequestLinkage(taskId, clientId ?? null);

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
      <div className={`${PANEL} text-body-small text-m-on-surface-variant`}>
        Original context unavailable: {error}
      </div>
    );
  }
  // Height matches the collapsed panel so the card doesn't jump when the
  // ClickUp round-trip lands.
  if (!ctx) return <Skeleton className="h-[4.5rem] w-full rounded-md" />;

  const budgetPoints = ctx.original_points;
  const overBudget = budgetPoints !== null && budgetPoints > 0
    ? Math.round((ctx.points_consumed / budgetPoints) * 100)
    : null;
  // What the budget becomes if this request is approved.
  const afterPoints =
    budgetPoints !== null && requestedPoints ? budgetPoints + requestedPoints : null;
  // A due-date-only request asks for no points, so approving it leaves any
  // overrun unfunded. Make that number explicit rather than omitting the line.
  const unfundedPoints =
    !requestedPoints && budgetPoints !== null && ctx.points_consumed > budgetPoints
      ? Math.round((ctx.points_consumed - budgetPoints) * 100) / 100
      : null;

  const burn = aggregateBurn(linkage?.retainers ?? []);

  return (
    <div className={`space-y-3 ${PANEL}`}>
      {/* Everything an approver needs to decide sits on this one line; the
          supporting detail is a disclosure away. Native <details> — no
          collapsible primitive in the design system to reach for. */}
      <Disclosure
        summary={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-label-large text-m-on-surface-variant">Original task</span>
            <span className="font-mono tabular-nums text-body-small text-m-on-surface">
              {budgetPoints !== null ? fmtPoints(budgetPoints) : "no points set"}
            </span>
            {overBudget !== null && (
              <Badge
                variant={overBudget > 100 ? "destructive" : overBudget > 75 ? "warning" : "muted"}
                className="font-mono tabular-nums"
              >
                {`${overBudget}% used`}
              </Badge>
            )}
            {requestedPoints ? (
              <Badge variant="outline" className="font-mono tabular-nums">
                {`requested +${fmtPoints(requestedPoints)}`}
              </Badge>
            ) : unfundedPoints !== null ? (
              <Badge variant="destructive" className="font-mono tabular-nums">
                {`no budget requested · ${fmtPoints(unfundedPoints)} unfunded`}
              </Badge>
            ) : (
              <Badge variant="outline">no budget requested</Badge>
            )}
            <BillingBadge billing={linkage?.billing} />
            {burn && (
              <Badge
                variant={burn.pct >= 85 ? "destructive" : burn.pct >= 70 ? "warning" : "muted"}
                className="font-mono tabular-nums"
              >
                {`retainer ${burn.pct}% · ${burn.hoursUsed}h of ${burn.hoursTarget}h`}
              </Badge>
            )}
          </div>
        }
      >
        <div className="flex justify-end">
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
            <Fig>{budgetPoints !== null ? fmtPoints(budgetPoints) : "no points set"}</Fig>
          </Stat>
          <Stat label="Time spent">
            <Fig>{`${ctx.points_consumed} pt`}</Fig>
            <Fig className="text-m-on-surface-variant">{` · ${fmtHours(ctx.time_spent_ms)}`}</Fig>
          </Stat>
          <Stat label="Consumed">
            {overBudget === null ? (
              "—"
            ) : (
              <Badge
                variant={overBudget > 100 ? "destructive" : overBudget > 75 ? "warning" : "muted"}
                className="font-mono tabular-nums"
              >
                {`${overBudget}% of budget`}
              </Badge>
            )}
          </Stat>
          <Stat label="Due"><Fig>{fmtDate(ctx.due_date)}</Fig></Stat>

          <Stat label="Status">{ctx.status ?? "—"}</Stat>
          <Stat label="List">{ctx.list_name ?? "—"}</Stat>
          <Stat label="Assigned">{ctx.assignees.join(", ") || "—"}</Stat>
          <Stat label="Created"><Fig>{fmtDate(ctx.date_created)}</Fig></Stat>
        </dl>

        {(priorPoints > 0 || afterPoints !== null || unfundedPoints !== null) && (
          <div className="flex flex-wrap items-center gap-2 text-body-small">
            {priorPoints > 0 && (
              <Badge variant="warning">
                {`already extended by ${fmtPoints(priorPoints)} (not in the time above)`}
              </Badge>
            )}
            {afterPoints !== null && (
              <span className="text-m-on-surface-variant">
                Budget if approved:{" "}
                <span className="text-m-on-surface"><Fig>{fmtPoints(afterPoints)}</Fig></span>
              </span>
            )}
            {unfundedPoints !== null && (
              <span className="text-m-on-surface-variant">
                This request adds no budget — approving it leaves{" "}
                <Fig className="text-m-error">{fmtPoints(unfundedPoints)}</Fig> already spent
                beyond the <Fig>{fmtPoints(budgetPoints)}</Fig> budget unfunded.
              </span>
            )}
          </div>
        )}
      </Disclosure>

      <BillingAndProject
        linkage={linkage}
        requestedPoints={requestedPoints ?? null}
        taskHours={ctx.time_spent_ms / 3_600_000}
      />

      <Disclosure
        summary={<span className="text-label-large text-m-on-surface-variant">Original brief</span>}
      >
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-body-small text-m-on-surface">
          {ctx.description ? withLinks(ctx.description) : "No description on the ClickUp task."}
        </p>
      </Disclosure>
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

/** Collapsed section whose summary line stays readable when closed. */
function Disclosure({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      {/* items-start, not items-center: the summary wraps to several lines on
          narrow viewports and a vertically-centred chevron detaches from the
          label it belongs to. */}
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm outline-none ring-offset-2 ring-offset-m-surface-container-low focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" />
        <div className="min-w-0 flex-1">{summary}</div>
      </summary>
      <div className="mt-3 space-y-3 pl-6">{children}</div>
    </details>
  );
}

const BILLING: Record<"retainer" | "adhoc", { label: string; variant: "muted" | "success" }> = {
  retainer: { label: "Retainer", variant: "muted" },
  adhoc: { label: "Ad-hoc · billable", variant: "success" },
};

function BillingBadge({ billing }: { billing?: "retainer" | "adhoc" | null }) {
  // Undefined = still loading. Null = the task has no brief, so we genuinely
  // don't know — say so rather than defaulting to the common value.
  if (billing === undefined) return null;
  if (billing === null) return <Badge variant="outline">billing unknown</Badge>;
  const b = BILLING[billing];
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

/**
 * What approving this costs commercially: whether the extra points are already
 * paid for, and what bigger thing absorbs them.
 */
function BillingAndProject({
  linkage,
  requestedPoints,
  taskHours,
}: {
  linkage: ReturnType<typeof useRequestLinkage>["data"];
  requestedPoints: number | null;
  taskHours: number;
}) {
  if (!linkage) return null;
  const { billing, project, retainers, countedInBurn } = linkage;
  const burn = aggregateBurn(retainers);
  const configured = retainers.filter((r) => !r.needsSetup);
  const extraHours = requestedPoints ? pointsToHours(requestedPoints) : 0;

  return (
    <div className="space-y-2 border-t border-m-outline-variant/60 pt-3">
      <p className="max-w-prose text-body-small">
        <span className="text-label-small text-m-on-surface-variant">Billing</span>{" "}
        {billing === "adhoc" ? (
          <span className="text-m-on-surface">
            Ad-hoc — approving this is separately billable to the client.
          </span>
        ) : billing === "retainer" ? (
          <span className="text-m-on-surface">
            Retainer — no extra invoice
            {requestedPoints ? (
              <>
                ; the <Fig>{fmtPoints(requestedPoints)}</Fig> comes out of the monthly fee
              </>
            ) : null}
            .
          </span>
        ) : (
          <span className="text-m-on-surface-variant">
            No brief in Conductor for this task — billing can't be determined.
          </span>
        )}
      </p>

      {project ? (
        <div className="flex flex-wrap items-center gap-2 text-body-small">
          <span className="text-label-small text-m-on-surface-variant">Project</span>
          <Link to={`/projects/${project.id}`} className="text-m-primary hover:underline">
            {project.name ?? "Untitled project"}
          </Link>
          <Badge variant="outline">{project.status.replace(/_/g, " ")}</Badge>
          <ProjectHealth
            plannedHours={project.plannedHours}
            actualHours={project.actualHours}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-body-small">
          <span className="text-label-small text-m-on-surface-variant">Project</span>
          <span className="text-m-on-surface-variant">
            Standalone task — not part of a tracked project
          </span>
        </div>
      )}

      {/* Always visible, and not gated on a retainer existing: an approver
          reading any burn or budget number needs to know this task's hours
          aren't in it. */}
      {!countedInBurn && taskHours > 0 && (
        <p className="max-w-prose text-body-small text-m-error">
          This task's <Fig>{Math.round(taskHours * 10) / 10}h</Fig> has not been mapped to a project by
          actuals sync, so it is missing from every hours figure below — the real burn is higher.
        </p>
      )}

      {configured.length > 0 && burn && (
        <Disclosure
          summary={
            <div className="flex flex-wrap items-center gap-2 text-body-small">
              <span className="text-label-small text-m-on-surface-variant">
                {configured.length === 1 ? "Retainer" : `${configured.length} retainers`} this month
              </span>
              <Fig className="text-m-on-surface">{`${burn.hoursUsed}h of ${burn.hoursTarget}h`}</Fig>
              <Badge
                variant={burn.pct >= 85 ? "destructive" : burn.pct >= 70 ? "warning" : "muted"}
                className="font-mono tabular-nums"
              >
                {`${burn.pct}% burned`}
              </Badge>
              {extraHours > 0 && (
                <span className="text-m-on-surface-variant">
                  {`this request adds ${Math.round(extraHours * 10) / 10}h → ${
                    burn.hoursTarget > 0
                      ? Math.round(((burn.hoursUsed + extraHours) / burn.hoursTarget) * 100)
                      : 0
                  }%`}
                </span>
              )}
            </div>
          }
        >
          <ul className="space-y-0.5">
            {configured.map((r) => (
              <li
                key={r.projectId}
                className="flex flex-wrap items-center gap-2 text-label-small text-m-on-surface-variant"
              >
                <Link to={`/projects/${r.projectId}`} className="text-m-primary hover:underline">
                  open
                </Link>
                <Fig className="text-m-on-surface">{`${r.hoursUsed}h`}</Fig>
                <Fig>{`of ${r.hoursTarget}h`}</Fig>
                <span
                  className={
                    r.rag === "red"
                      ? "text-m-error"
                      : r.rag === "amber"
                        ? "text-m-on-surface"
                        : "text-m-on-surface-variant"
                  }
                >
                  {`${r.burnPct}%`}
                </span>
                {r.isOverrunRisk && <span className="text-m-error">on pace to overrun</span>}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function ProjectHealth({
  plannedHours,
  actualHours,
}: {
  plannedHours: number;
  actualHours: number;
}) {
  if (plannedHours <= 0) {
    return <span className="text-m-on-surface-variant">no planned hours to track against</span>;
  }
  const pct = Math.round((actualHours / plannedHours) * 100);
  return (
    <>
      <Fig className="text-m-on-surface">
        {`${Math.round(actualHours * 10) / 10}h of ${Math.round(plannedHours * 10) / 10}h`}
      </Fig>
      <Badge
        variant={pct > 100 ? "destructive" : pct > 85 ? "warning" : "muted"}
        className="font-mono tabular-nums"
      >
        {`${pct}% of plan`}
      </Badge>
    </>
  );
}
