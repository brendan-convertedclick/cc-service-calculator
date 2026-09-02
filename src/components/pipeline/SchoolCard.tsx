// src/components/pipeline/SchoolCard.tsx
//
// One school on the Journey board. A school with no planning session yet
// gets the minimal "Not started" shape — there is no year, no comb, no
// hours, nothing to book against — everything else gets the full card the
// UX spec describes. Two shapes, one component, because BoardSchool already
// carries `yearId: null` as the discriminator; a second component would just
// re-decide the same branch.

import { Link } from "react-router-dom";
import { ArrowRight, MapPin, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatHours } from "@/lib/utils";
import { initials } from "@/components/systems/SystemBlockNode";
import type { TeamMember } from "@/hooks/useTeam";
import type { BoardSchool } from "@/hooks/usePipelineBoard";
import { YearComb } from "@/components/pipeline/YearComb";

export function SchoolCard({
  school,
  team,
  colorById,
  onOpenDrawer,
  onRunPlanning,
}: {
  school: BoardSchool;
  team: TeamMember[];
  colorById: Map<string, string>;
  /** Opens the drawer, optionally landed on a specific month (the NEXT button). */
  onOpenDrawer: (initialMonth?: number) => void;
  /** "Not started" card only — opens the planning-session dialog. */
  onRunPlanning: () => void;
}) {
  const owner = school.accountOwnerId ? team.find((t) => t.id === school.accountOwnerId) : undefined;

  if (!school.yearId) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <p className="text-title-small text-m-on-surface">{school.clientName}</p>
          {school.town ? (
            <p className="flex items-center gap-1 text-label-small text-m-on-surface-variant">
              <MapPin className="h-3 w-3" /> {school.town}
            </p>
          ) : null}
        </div>
        <Badge variant="muted" className="w-fit">
          Not started
        </Badge>
        <Button size="sm" onClick={onRunPlanning}>
          Run planning session
        </Button>
      </Card>
    );
  }

  const nextMonthNo = school.currentMonthNo ? school.currentMonthNo + 1 : null;
  const nextMonth = nextMonthNo ? school.months.find((m) => m.month_no === nextMonthNo) : undefined;
  const progressPct = school.progress.total > 0 ? Math.round((school.progress.done / school.progress.total) * 100) : 0;

  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-elev-2">
      <button
        type="button"
        onClick={() => onOpenDrawer()}
        className="flex flex-col gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-title-small text-m-on-surface">{school.clientName}</p>
            {school.town ? (
              <p className="flex items-center gap-1 truncate text-label-small text-m-on-surface-variant">
                <MapPin className="h-3 w-3 shrink-0" /> {school.town}
              </p>
            ) : null}
          </div>
          {owner ? (
            <span
              title={owner.full_name}
              className="grid h-7 w-7 flex-none place-items-center rounded-full text-label-small font-bold leading-none text-white"
              style={{ background: colorById.get(owner.id) }}
            >
              {initials(owner.full_name)}
            </span>
          ) : (
            <span
              title="No account owner set"
              className="grid h-7 w-7 flex-none place-items-center rounded-full border border-dashed border-m-outline text-m-on-surface-variant"
            >
              <User className="h-3.5 w-3.5" />
            </span>
          )}
        </div>

        {school.currentMonthNo ? (
          <p className="text-label-medium text-m-on-surface-variant">
            M{school.currentMonthNo} · {school.currentTheme}
          </p>
        ) : (
          <Badge variant="success" className="w-fit">
            Year complete
          </Badge>
        )}

        <YearComb months={school.months} currentMonthNo={school.currentMonthNo} />

        {school.progress.total > 0 ? (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-m-surface-container-high">
              <div
                className="h-full rounded-full bg-m-primary transition-[width] motion-reduce:transition-none"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
              {school.progress.done}/{school.progress.total}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {school.late.ours > 0 ? (
            <Badge variant="destructive">{school.late.ours} late · ours</Badge>
          ) : null}
          {school.late.theirs > 0 ? (
            <Badge variant="warning">{school.late.theirs} late · theirs</Badge>
          ) : null}
          <span className="ml-auto font-mono text-label-small tabular-nums text-m-on-surface-variant">
            {formatHours(school.hoursThisMonth)} booked
          </span>
        </div>
      </button>

      <div className={cn("flex items-center gap-2", !nextMonth && "justify-end")}>
        {nextMonth ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 justify-start"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDrawer(nextMonth.month_no);
            }}
          >
            <ArrowRight className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              NEXT → M{nextMonth.month_no} · {nextMonth.theme}
            </span>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="secondary" onClick={(e) => e.stopPropagation()}>
          <Link to={`/pipeline/${school.yearId}`}>PLAN</Link>
        </Button>
      </div>
    </Card>
  );
}
