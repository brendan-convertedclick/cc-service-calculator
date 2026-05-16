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
import { OutputMultiplierShell } from "@/components/productivity/OutputMultiplierShell";
import { DeliveryTab } from "@/components/productivity/DeliveryTab";
import { ProfitabilityTab } from "@/components/productivity/ProfitabilityTab";
import { TaskBreakdownTab } from "@/components/productivity/TaskBreakdownTab";

export function ProductivityPage() {
  const [view, setView] = useState<View>("week");
  const [date, setDate] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [pageTab, setPageTab] = useState<"sprint" | "multiplier" | "delivery" | "profitability" | "tasks">("multiplier");

  const { data: members = [] } = useTeam();
  const { data: settings } = useSettings();
  const goalPoints = settings?.productivity_goal_points ?? 40;

  const { data, isLoading, isError, refetch, isFetching } = useProductivity(
    view,
    date,
    selectedUserId ?? undefined,
  );

  const sprintChartData = data ? buildChartData(data.sprintPoints, view) : [];
  const hoursChartData = data ? buildHoursData(data.timeEntries, view) : [];

  // Build per-member point totals for sidebar chips
  const pointsByMember: Record<number, number> = {};
  for (const sp of data?.sprintPoints ?? []) {
    pointsByMember[sp.userId] = (pointsByMember[sp.userId] ?? 0) + sp.businessCreatedPoints + sp.selfCreatedPoints;
  }

  const defaultMeta = {
    periodLabel: "",
    totalPoints: 0,
    totalHours: 0,
    totalOverheadHours: 0,
    dailyAvg: 0,
    activeContributors: 0,
  };

  const selectedMemberEmail = selectedUserId
    ? members.find((m) => m.clickup_user_id === selectedUserId)?.email ?? undefined
    : undefined;

  return (
    <div className="flex h-full">
      <TeamSidebar
        members={members}
        selectedUserId={selectedUserId}
        onSelect={setSelectedUserId}
        pointsByMember={pointsByMember}
      />

      <main className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {/* Page tab switcher */}
        <div className="flex gap-0 border-b border-m-outline-variant mb-6 -mx-6 px-6">
          {(["multiplier", "sprint", "tasks", "delivery", "profitability"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setPageTab(tab)}
              data-testid={`productivity-tab-${tab}`}
              className={[
                "px-5 py-3.5 text-label-medium border-b-2 -mb-px transition-colors",
                pageTab === tab
                  ? "text-m-primary border-m-primary"
                  : "text-m-on-surface-variant border-transparent hover:text-m-on-surface",
              ].join(" ")}
            >
              {tab === "sprint"
                ? "Sprint Output"
                : tab === "delivery"
                  ? "Delivery"
                  : tab === "profitability"
                    ? "Profitability"
                    : tab === "tasks"
                      ? "Tasks"
                      : "Output Multiplier"}
            </button>
          ))}
        </div>

        {pageTab === "sprint" && (
          <>
            <ProductivityControls
              view={view}
              date={date}
              periodLabel={data?.meta.periodLabel ?? ""}
              onViewChange={setView}
              onDateChange={setDate}
              onRefresh={refetch}
              isRefreshing={isFetching}
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
                <HoursTrackedChart data={hoursChartData} members={members} selectedUserId={selectedUserId} />
                {view !== "year" && (
                  <PointModificationsTable
                    modifications={data?.pointModifications ?? []}
                    members={members}
                  />
                )}
              </>
            )}
          </>
        )}

        {pageTab === "multiplier" && (
          <OutputMultiplierShell loggedBy={selectedMemberEmail} />
        )}

        {pageTab === "delivery" && (
          <DeliveryTab
            view={view}
            date={date}
            onViewChange={setView}
            onDateChange={setDate}
            members={members}
            selectedUserId={selectedUserId}
            clickupUserId={selectedUserId ?? undefined}
          />
        )}

        {pageTab === "profitability" && (
          <ProfitabilityTab />
        )}

        {pageTab === "tasks" && (
          <TaskBreakdownTab members={members} selectedUserId={selectedUserId} />
        )}
      </main>
    </div>
  );
}
