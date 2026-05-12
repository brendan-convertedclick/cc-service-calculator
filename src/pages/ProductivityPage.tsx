// src/pages/ProductivityPage.tsx
import { useState } from "react";
import { useTeam } from "@/hooks/useTeam";
import { useSettings } from "@/hooks/useSettings";
import { useProductivity, buildChartData, buildHoursData } from "@/hooks/useProductivity";
import type { View } from "@/hooks/useProductivity";
import { TeamSidebar } from "@/components/productivity/TeamSidebar";
import { ProductivityControls } from "@/components/productivity/ProductivityControls";
import { MetricCards } from "@/components/productivity/MetricCards";
import { SprintPointsChart } from "@/components/productivity/SprintPointsChart";
import { HoursTrackedChart } from "@/components/productivity/HoursTrackedChart";
import { PointModificationsTable } from "@/components/productivity/PointModificationsTable";

export function ProductivityPage() {
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: members = [] } = useTeam();
  const { data: settings } = useSettings();
  const goalPoints = settings?.productivity_goal_points ?? 40;

  const { data, isLoading, isError } = useProductivity(
    view,
    date,
    selectedUserId ?? undefined,
  );

  const sprintChartData = data ? buildChartData(data.sprintPoints) : [];
  const hoursChartData = data ? buildHoursData(data.timeEntries) : [];

  // Build per-member point totals for sidebar chips
  const pointsByMember: Record<number, number> = {};
  for (const sp of data?.sprintPoints ?? []) {
    pointsByMember[sp.userId] = (pointsByMember[sp.userId] ?? 0) + sp.businessCreatedPoints + sp.selfCreatedPoints;
  }

  const defaultMeta = {
    periodLabel: "",
    totalPoints: 0,
    totalHours: 0,
    dailyAvg: 0,
    activeContributors: 0,
  };

  return (
    <div className="flex h-full">
      <TeamSidebar
        members={members}
        selectedUserId={selectedUserId}
        onSelect={setSelectedUserId}
        pointsByMember={pointsByMember}
      />

      <main className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        <ProductivityControls
          view={view}
          date={date}
          periodLabel={data?.meta.periodLabel ?? ""}
          onViewChange={setView}
          onDateChange={setDate}
        />

        {isError && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
            Failed to load productivity data. Check that ClickUp is enabled in Settings.
          </p>
        )}

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
            Loading…
          </div>
        ) : (
          <>
            <MetricCards meta={data?.meta ?? defaultMeta} goalPoints={goalPoints} />
            <SprintPointsChart
              data={sprintChartData}
              members={members}
              goalPoints={goalPoints}
              selectedUserId={selectedUserId}
            />
            <HoursTrackedChart data={hoursChartData} />
            {view !== "year" && (
              <PointModificationsTable
                modifications={data?.pointModifications ?? []}
                members={members}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
