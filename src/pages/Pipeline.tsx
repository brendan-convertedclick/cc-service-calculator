// src/pages/Pipeline.tsx
//
// /pipeline — "The Journey". Thirteen columns: a leading Not-started column
// (no planning session yet, or a year that just completed — see below) and
// M1..M12. Cards are schools, each bucketed by ITS OWN currentMonthNo —
// there is no shared calendar (see the brief), so two schools can both sit
// in the M9 column having started ten months apart.
//
// usePipelineBoard() already filters to `completed_at is null`, so a school
// whose year just finished (M12 closed) simply has no active year any more
// and falls back into Not-started — which is exactly right: "M12 closing
// ends the year and books the next planning session" (the brief), and a
// fresh planning session is what Not-started's card offers.
//
// The board itself is never a drop target — only the per-school planner
// (/pipeline/:yearId) drags tasks between months.

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineBoard, usePipelineTemplate } from "@/hooks/usePipelineBoard";
import { useTeam, memberColors } from "@/hooks/useTeam";
import { SchoolCard } from "@/components/pipeline/SchoolCard";
import { AddSchoolDialog } from "@/components/pipeline/AddSchoolDialog";
import { PlanningSessionDialog } from "@/components/pipeline/PlanningSessionDialog";
import { SchoolDrawer } from "@/components/pipeline/SchoolDrawer";
import type { BoardSchool } from "@/hooks/usePipelineBoard";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function Pipeline() {
  const { data: schools, isLoading } = usePipelineBoard();
  const { data: template } = usePipelineTemplate();
  const { data: team } = useTeam();
  const colorById = memberColors(team ?? []);

  const [addOpen, setAddOpen] = useState(false);
  const [planning, setPlanning] = useState<BoardSchool | null>(null);
  const [drawer, setDrawer] = useState<{ yearId: string; initialMonth: number | null } | null>(null);

  const buckets = new Map<number | null, BoardSchool[]>([[null, []], ...MONTHS.map((m): [number, BoardSchool[]] => [m, []])]);
  for (const s of schools ?? []) {
    const key = s.yearId ? s.currentMonthNo : null;
    (buckets.get(key ?? null) ?? buckets.get(null)!).push(s);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-medium">Pipeline</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            Every school runs its own Month 1 to Month 12 — there is no shared calendar.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Add a school
        </Button>
      </div>

      {isLoading ? (
        <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          <Column title="Not started" schools={buckets.get(null) ?? []}>
            {(s) => (
              <SchoolCard
                key={s.clientId}
                school={s}
                team={team ?? []}
                colorById={colorById}
                onOpenDrawer={() => {}}
                onRunPlanning={() => setPlanning(s)}
              />
            )}
          </Column>
          {MONTHS.map((m) => (
            <Column key={m} title={`M${m}`} schools={buckets.get(m) ?? []}>
              {(s) => (
                <SchoolCard
                  key={s.clientId}
                  school={s}
                  team={team ?? []}
                  colorById={colorById}
                  onOpenDrawer={(initialMonth) => setDrawer({ yearId: s.yearId!, initialMonth: initialMonth ?? null })}
                  onRunPlanning={() => setPlanning(s)}
                />
              )}
            </Column>
          ))}
        </div>
      )}

      <AddSchoolDialog open={addOpen} onOpenChange={setAddOpen} />

      {planning ? (
        <PlanningSessionDialog
          open={!!planning}
          onOpenChange={(open) => !open && setPlanning(null)}
          clientId={planning.clientId}
          clientName={planning.clientName}
          template={template ?? null}
          onSaved={(yearId) => setDrawer({ yearId, initialMonth: null })}
        />
      ) : null}

      {drawer ? (
        <SchoolDrawer
          open={!!drawer}
          onOpenChange={(open) => !open && setDrawer(null)}
          yearId={drawer.yearId}
          initialMonth={drawer.initialMonth}
        />
      ) : null}
    </div>
  );
}

function Column({
  title,
  schools,
  children,
}: {
  title: string;
  schools: BoardSchool[];
  children: (school: BoardSchool) => React.ReactNode;
}) {
  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <p className="text-label-small font-medium uppercase tracking-wide text-m-on-surface-variant">{title}</p>
        <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">{schools.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {schools.map(children)}
        {schools.length === 0 ? (
          <p className="py-4 text-center text-label-small text-m-on-surface-variant">—</p>
        ) : null}
      </div>
    </div>
  );
}
