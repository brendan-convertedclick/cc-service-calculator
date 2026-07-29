import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtPtH, pointsToHours } from "@/lib/sprint-points";
import { consumedPct, useTaskContext } from "@/hooks/useTaskContext";
import { aggregateBurn, useRequestLinkage } from "@/hooks/useRequestLinkage";
import { buildVerdict, daysBetween, type VerdictTone } from "@/lib/escalation-verdict";
import { askedForPoints } from "@/types/extension-requests";
import type { RailRow } from "./EscalationRail";

const TONE: Record<VerdictTone, "success" | "warning" | "destructive" | "muted"> = {
  ok: "success",
  warn: "warning",
  danger: "destructive",
  mute: "muted",
};

function fmtDate(value: string | number | null): string {
  if (value === null) return "—";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-ZA");
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * One escalation, answered in a fixed order: the call, then what's being
 * approved, why it was asked for, what was originally briefed, who pays, and
 * who already signed it off. The order never changes between requests — that
 * consistency is the point of the layout.
 */
export function EscalationDetail({
  row,
  priorOverrunsThisMonth,
  actions,
}: {
  row: RailRow;
  priorOverrunsThisMonth: number;
  actions: React.ReactNode;
}) {
  const { data: ctx, isPending: ctxPending, error: ctxError } = useTaskContext(
    row.parent_clickup_task_id,
  );
  const { data: linkage } = useRequestLinkage(row.parent_clickup_task_id, row.client_id);

  const burn = aggregateBurn(linkage?.retainers ?? []);
  const extraHours = row.extra_points ? pointsToHours(Number(row.extra_points)) : 0;
  const burnPctAfter =
    burn && burn.hoursTarget > 0
      ? Math.round(((burn.hoursUsed + extraHours) / burn.hoursTarget) * 100)
      : null;

  const verdict = buildVerdict({
    requesterName: row.requester?.full_name ?? null,
    clientName: row.client?.name ?? null,
    extraPoints: row.extra_points === null ? null : Number(row.extra_points),
    originalPoints: ctx?.original_points ?? (row.original_points === null ? null : Number(row.original_points)),
    pointsConsumed: ctx?.points_consumed ?? null,
    originalDueDate: row.original_due_date,
    requestedDueDate: row.requested_due_date,
    billing: linkage?.billing ?? null,
    billingResolved: !!linkage,
    burnPctAfter,
    priorOverrunsThisMonth,
    hoursMissingFromBurn: linkage ? !linkage.countedInBurn && (ctx?.time_spent_ms ?? 0) > 0 : false,
  });

  const pointsAsked = askedForPoints(row);
  const pct = consumedPct(ctx);
  const budgetPoints = ctx?.original_points ?? null;
  const afterPoints =
    budgetPoints !== null && row.extra_points ? budgetPoints + Number(row.extra_points) : null;
  const dayCount = daysBetween(row.original_due_date, row.requested_due_date);

  return (
    <article className="flex min-h-0 flex-1 flex-col gap-5 p-6 pb-0">
      {/* The call, before any evidence. Labelled so it's reachable by role —
          assistive tech and the e2e suite both find it the same way. */}
      <section aria-label="Verdict" className="space-y-2.5 rounded-md bg-m-surface p-5 shadow-elev-1">
        <div className="flex flex-wrap items-center gap-2">
          {verdict.flags.map((f) => (
            <Badge key={f.label} variant={TONE[f.tone]} className={f.tone === "danger" ? "font-mono tabular-nums" : undefined}>
              {f.label}
            </Badge>
          ))}
        </div>
        <p className="max-w-[58ch] text-title-small font-normal leading-snug text-m-on-surface">
          {verdict.headline}
        </p>
      </section>

      {ctxError && (
        <p className="rounded-md bg-m-surface px-4 py-3 text-body-small text-m-error">
          ClickUp didn't answer, so budget and spend are missing below:{" "}
          {ctxError instanceof Error ? ctxError.message : String(ctxError)}
        </p>
      )}

      <dl className="divide-y divide-m-outline-variant overflow-hidden rounded-md bg-m-surface shadow-elev-1">
        <Block label="Approving">
          {pointsAsked ? (
            <p>
              <span className="font-mono tabular-nums">+{fmtPtH(row.extra_points)}</span> on top of{" "}
              <span className="font-mono tabular-nums">{fmtPtH(budgetPoints)}</span>
              {afterPoints !== null && (
                <span className="block text-body-small text-m-on-surface-variant">
                  New budget becomes{" "}
                  <span className="font-mono tabular-nums">{fmtPtH(afterPoints)}</span>
                </span>
              )}
            </p>
          ) : (
            // A stated zero is the requester's answer, not a gap. Say so
            // plainly — it's the difference between "costs nothing" and
            // "nobody said what this costs".
            row.extra_points !== null && (
              <p>
                No extra budget — the deadline moves, the{" "}
                <span className="font-mono tabular-nums">{fmtPtH(budgetPoints)}</span> budget
                doesn't.
              </p>
            )
          )}
          {row.requested_due_date !== null && (
            <p className={row.extra_points !== null ? "mt-1" : undefined}>
              Due{" "}
              <span className="font-mono tabular-nums">{row.original_due_date ?? "—"}</span> →{" "}
              <span className="font-mono tabular-nums">{row.requested_due_date}</span>
              {dayCount !== null && (
                <span className="text-m-on-surface-variant"> ({dayCount} days)</span>
              )}
            </p>
          )}
          {row.extra_points === null && row.requested_due_date === null && <p>—</p>}
        </Block>

        <Block label="Because">
          <p className="max-w-prose whitespace-pre-wrap">
            {row.reason || row.due_date_reason || "No reason given."}
          </p>
          {row.info_request && (
            <p className="mt-2 max-w-prose whitespace-pre-wrap text-body-small text-m-on-surface-variant">
              <span className="text-m-on-surface">You asked:</span> {row.info_request}
            </p>
          )}
          {row.info_response && (
            <p className="mt-1 max-w-prose whitespace-pre-wrap text-body-small text-m-on-surface-variant">
              <span className="text-m-on-surface">They answered:</span> {row.info_response}
            </p>
          )}
        </Block>

        <Block label="Briefed as">
          {ctxPending ? (
            <Skeleton className="h-10 w-full max-w-md" />
          ) : ctx ? (
            <>
              <p>
                <span className="font-mono tabular-nums">{fmtPtH(ctx.original_points)}</span>, due{" "}
                <span className="font-mono tabular-nums">{fmtDate(ctx.due_date)}</span>, created{" "}
                <span className="font-mono tabular-nums">{fmtDate(ctx.date_created)}</span>
              </p>
              <p className="text-body-small text-m-on-surface-variant">
                Spent so far{" "}
                <span className="font-mono tabular-nums text-m-on-surface">
                  {ctx.points_consumed} pt · {Math.round((ctx.time_spent_ms / 3_600_000) * 10) / 10}h
                </span>
                {pct !== null && (
                  <>
                    {" — "}
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        pct > 100 ? "text-m-error" : "text-m-on-surface",
                      )}
                    >
                      {pct}%
                    </span>{" "}
                    of budget
                  </>
                )}
              </p>
              <p className="mt-1 text-label-small text-m-on-surface-variant">
                {ctx.status ?? "—"} · {ctx.list_name ?? "—"} ·{" "}
                {ctx.assignees.join(", ") || "unassigned"}
              </p>
              <a
                href={ctx.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-label-small text-m-primary hover:underline"
              >
                Open the task in ClickUp <ExternalLink className="h-3 w-3" />
              </a>
            </>
          ) : (
            <p className="text-m-on-surface-variant">Not available.</p>
          )}
        </Block>

        <Block label="Paid by">
          {!linkage ? (
            <Skeleton className="h-10 w-full max-w-md" />
          ) : (
            <>
              <p>{billingLine(linkage.billing, row.client?.name ?? "the client")}</p>

              {linkage.project ? (
                <p className="mt-1 text-body-small text-m-on-surface-variant">
                  Part of{" "}
                  <Link to={`/projects/${linkage.project.id}`} className="text-m-primary hover:underline">
                    {linkage.project.name ?? "an untracked project"}
                  </Link>
                </p>
              ) : (
                <p className="mt-1 text-body-small text-m-on-surface-variant">
                  Standalone task — not part of a tracked project.
                </p>
              )}

              {burn && (
                <div className="mt-2.5 max-w-sm space-y-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-m-surface-container-high">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        burn.pct >= 85 ? "bg-m-error" : burn.pct >= 70 ? "bg-amber-500" : "bg-emerald-600",
                      )}
                      style={{ width: `${Math.min(100, burn.pct)}%` }}
                    />
                  </div>
                  <p className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
                    {burn.hoursUsed}h of {burn.hoursTarget}h · {burn.pct}% burned
                    {burnPctAfter !== null && extraHours > 0 && ` → ${burnPctAfter}% after this`}
                  </p>
                </div>
              )}

              {!linkage.countedInBurn && (ctx?.time_spent_ms ?? 0) > 0 && (
                <p className="mt-2 max-w-prose text-body-small text-m-error">
                  This task's{" "}
                  <span className="font-mono tabular-nums">
                    {Math.round(((ctx?.time_spent_ms ?? 0) / 3_600_000) * 10) / 10}h
                  </span>{" "}
                  has not been mapped to a project by the actuals sync, so it is missing from the
                  retainer figures above — the real burn is higher.
                </p>
              )}
            </>
          )}
        </Block>

        <Block label="Signed off">
          {row.admin_approved_at ? (
            <p>
              {row.admin_approver?.full_name ?? "An admin"} approved the admin leg on{" "}
              <span className="font-mono tabular-nums">{fmtWhen(row.admin_approved_at)}</span> and
              escalated it to you.
            </p>
          ) : (
            <p className="text-m-on-surface-variant">
              Raised {fmtWhen(row.created_at)}. No admin sign-off recorded — this predates the
              two-stage flow.
            </p>
          )}
        </Block>
      </dl>

      {/* Sticky rather than mt-auto: on a short request the actions would sit
          in the middle of empty space, and on a long one they'd be below the
          fold. The decision is always one glance from the evidence. */}
      <div className="sticky bottom-0 -mx-6 mt-auto border-t border-m-outline-variant bg-m-surface-container-low px-6 py-4">
        {actions}
      </div>
    </article>
  );
}

function billingLine(billing: "retainer" | "adhoc" | null, client: string): React.ReactNode {
  if (billing === "retainer") return `${client}'s retainer — approving this changes no invoice.`;
  if (billing === "adhoc") return `Ad-hoc work — approving this is separately billable to ${client}.`;
  return "No brief in Conductor for this task, so billing can't be determined.";
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-5 py-4 sm:grid-cols-[104px_1fr] sm:gap-5">
      <dt className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">
        {label}
      </dt>
      <dd className="text-body-medium text-m-on-surface">{children}</dd>
    </div>
  );
}
