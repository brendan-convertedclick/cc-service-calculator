// src/components/moments/AskSoon.tsx
//
// The point of Moments: what to bring up next. The next three weeks grouped
// Today / This week / Later, then recent one-off events nobody has asked
// about afterwards. "Mark as asked" is per occurrence and per stage — wishing
// someone luck before the final and asking how it went after are two
// conversations.

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useSetMomentAsked } from "@/hooks/useContactMoments";
import {
  askKey,
  askLine,
  daysBetween,
  occurrenceTitle,
  type AskStage,
  type MomentAsk,
  type Occurrence,
  type SoonList,
} from "@/lib/contact-moments";
import { todayISO } from "@/lib/dates";
import { cn, errorMessage } from "@/lib/utils";
import { KIND_CHIP } from "./kind-styles";

function relative(date: string): string {
  const d = daysBetween(todayISO(), date);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1) return `in ${d} days`;
  return d === -1 ? "yesterday" : `${-d} days ago`;
}

export function AskSoon({
  list,
  asked,
  onOpen,
}: {
  list: SoonList;
  asked: Map<string, MomentAsk>;
  onOpen: (o: Occurrence) => void;
}) {
  const groups: [string, Occurrence[], AskStage][] = [
    ["Today", list.today, "before"],
    ["This week", list.thisWeek, "before"],
    ["Later", list.later, "before"],
    ["Follow up: how did it go?", list.followUps, "after"],
  ];
  const empty = groups.every(([, items]) => items.length === 0);

  if (empty) {
    return (
      <p className="rounded-lg border border-dashed border-m-outline-variant p-4 text-body-small text-m-on-surface-variant">
        Nothing in the next three weeks. Click a day on the calendar to add a birthday or something coming up.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map(([label, items, stage]) =>
        items.length ? (
          <div key={label} className="flex flex-col gap-2">
            <h3 className="mt-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">{label}</h3>
            {items.map((o) => (
              <SoonRow
                key={`${o.moment.id}|${o.date}|${stage}`}
                o={o}
                stage={stage}
                ask={asked.get(askKey(o.moment.id, o.date, stage))}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

function SoonRow({
  o,
  stage,
  ask,
  onOpen,
}: {
  o: Occurrence;
  stage: AskStage;
  ask: MomentAsk | undefined;
  onOpen: (o: Occurrence) => void;
}) {
  const { currentUserId } = useAuth();
  const setAsked = useSetMomentAsked();
  const [, m, d] = o.date.split("-").map(Number);
  const mon = new Date(2026, m - 1, 1).toLocaleDateString("en-ZA", { month: "short" });

  async function toggle() {
    try {
      await setAsked.mutateAsync({ momentId: o.moment.id, date: o.date, stage, asked: !ask, by: currentUserId });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 rounded-lg border border-m-outline-variant p-2">
      <div className={cn("rounded-md py-1 text-center leading-tight", KIND_CHIP[o.moment.kind])}>
        <div className="text-title-medium tabular-nums">{d}</div>
        <div className="text-label-small uppercase">{mon}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <button type="button" onClick={() => onOpen(o)} className="text-left text-title-small hover:underline [overflow-wrap:anywhere]">
          {occurrenceTitle(o)}
        </button>
        <span className="text-body-small text-m-on-surface-variant [overflow-wrap:anywhere]">
          {o.moment.kind === "birthday" ? o.moment.clientName : `${o.moment.contactName} · ${o.moment.clientName}`} ·{" "}
          {relative(o.date)}
        </span>
        <span className="text-body-small [overflow-wrap:anywhere]">{askLine(o, stage)}</span>
        <div className="mt-1 flex items-center gap-2">
          {ask ? (
            <>
              <span className="text-label-medium text-m-tertiary">Asked ✓</span>
              <Button variant="ghost" size="sm" onClick={() => void toggle()} disabled={setAsked.isPending}>
                Undo
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void toggle()} disabled={setAsked.isPending}>
              Mark as asked
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
