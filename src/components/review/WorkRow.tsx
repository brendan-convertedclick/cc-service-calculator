// src/components/review/WorkRow.tsx
//
// A piece of briefed work on the client's own list, and what they see when
// they open it.
//
// IT IS NOT A ReviewItem AND MUST NOT BECOME ONE. Nobody has written this
// client an ask about it: there is no `client_approvals` row behind it, so
// there is nothing an Approve could record and nothing a reply could hang off
// (client_activity.approval_id is a foreign key). Keeping it a separate type
// with a separate row and a separate detail means the decision surface is
// gated in ZERO places rather than in five — no quick-approve tick, no
// Approve/Request changes, no answer box, because none of that is rendered
// here at all.
//
// What it IS: the honest answer to "is that all you're doing for us?". The
// client's list used to show only the handful of things somebody had drafted
// as a sign-off, so a client with eight live tasks saw two rows.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatWait } from "@/lib/client-waiting";
import { todayISO } from "@/lib/dates";
import type { ReviewWork } from "@/types/client-review";

/** "Needed by 14 Aug", and how far past it we are. Plain, never a red badge. */
function dueLabel(w: ReviewWork): { text: string; late: boolean } | null {
  if (!w.due_date) return null;
  const [y, m, d] = w.due_date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const when = new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });
  return { text: when, late: w.due_date < todayISO() };
}

export function WorkRow({
  work,
  selected,
  onSelect,
}: {
  work: ReviewWork;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const due = dueLabel(work);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(work.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(work.id);
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 border-b border-m-outline-variant p-3 text-left transition-colors last:border-b-0",
        selected ? "bg-m-surface-container-high" : "hover:bg-m-surface-container",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-title-small text-m-on-surface">{work.title}</p>
        <p className="mt-0.5 truncate text-body-medium text-m-on-surface-variant">
          {work.court === "client"
            ? "We're waiting on you for this one."
            : "We're working on this."}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {/* "Task" and not "Sign-off": there is nothing to sign here, and a
              label that implied otherwise would be the row promising a button
              it does not have. */}
          <Badge variant="outline">Task</Badge>
          {due ? (
            <Badge variant="outline">
              {due.late ? "Was needed by " : "Needed by "}
              {due.text}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The detail beside it. Read-only by construction, and it ends by naming the
 * one control that DOES exist — "Ask us something" on the rail — so a row in
 * the client's own court is never a dead end with nothing to press.
 */
export function WorkDetail({ work }: { work: ReviewWork }) {
  const due = dueLabel(work);
  const theirs = formatWait(work.waiting_ms);
  const ours = formatWait(work.our_ms);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 flex flex-wrap gap-1">
          <Badge variant="outline">Task</Badge>
        </div>
        <h2 className="text-headline-small text-m-on-surface">{work.title}</h2>
        {due ? (
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            {due.late ? "Was needed by" : "Needed by"} {due.text}
          </p>
        ) : null}
      </div>

      <div className="rounded-lg bg-m-surface-container p-4">
        <p className="text-body-medium text-m-on-surface">
          {work.court === "client"
            ? "This one's with you. We haven't sent it over for a formal sign-off, so there's nothing to press here."
            : "We're working on this one. Nothing needed from you right now — we'll be in touch when there is."}
        </p>
        <p className="mt-2 text-body-medium text-m-on-surface-variant">
          {work.court === "client"
            ? "Not sure what we need? Use Ask us something on the left and we'll come back to you."
            : "Anything you want to raise about it goes through Ask us something on the left."}
        </p>
      </div>

      {theirs !== "—" || ours !== "—" ? (
        <p className="text-label-large text-m-on-surface-variant">
          <span className="text-m-on-surface">{theirs}</span> with you
          {" · "}
          <span className="text-m-on-surface">{ours}</span> with us
        </p>
      ) : null}
    </div>
  );
}
