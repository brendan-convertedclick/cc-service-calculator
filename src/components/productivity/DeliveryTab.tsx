import { useDeliveryMetrics, buildRateChartData, buildValueChartData, buildSpeedChartData } from "@/hooks/useDeliveryMetrics";
import type { View } from "@/hooks/useProductivity";
import type { TeamMember } from "@/hooks/useTeam";
import { ProductivityControls } from "./ProductivityControls";
import { DeliveryMetricCards } from "./DeliveryMetricCards";
import { DeliveryRateChart } from "./DeliveryRateChart";
import { DeliverySpeedChart } from "./DeliverySpeedChart";
import { DeliveryValueChart } from "./DeliveryValueChart";

interface Props {
  view: View;
  date: string;
  onViewChange: (v: View) => void;
  onDateChange: (d: string) => void;
  members: TeamMember[];
  selectedUserId: number | null;
  clickupUserId?: number;
}

const DEFAULT_META = {
  periodLabel: "",
  workingDays: 0,
  overallExternalRate: 0,
  overallInternalRate: 0,
  avgCycleDays: 0,
  tasksPerWorkingDay: 0,
  totalValueZar: 0,
  avgYieldPerHour: 0,
  zarPerPoint: 500,
};

export function DeliveryTab({
  view, date, onViewChange, onDateChange,
  members, selectedUserId, clickupUserId,
}: Props) {
  const { data, isLoading, isError } = useDeliveryMetrics(view, date, clickupUserId);

  const rateChartData = data ? buildRateChartData(data.buckets, view) : [];
  const valueChartData = data ? buildValueChartData(data.buckets, view) : [];
  const speedChartData = data ? buildSpeedChartData(data.buckets, view) : [];

  return (
    <>
      <ProductivityControls
        view={view}
        date={date}
        periodLabel={data?.meta.periodLabel ?? ""}
        onViewChange={onViewChange}
        onDateChange={onDateChange}
      />

      {isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
          Failed to load delivery data. Check that ClickUp is enabled in Settings.
        </p>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
          Loading…
        </div>
      ) : (
        <div className="space-y-5">
          <DeliveryMetricCards meta={data?.meta ?? DEFAULT_META} />
          <DeliveryRateChart
            data={rateChartData}
            members={members}
            selectedUserId={selectedUserId}
          />
          <div className="grid grid-cols-2 gap-4">
            <DeliverySpeedChart data={speedChartData} />
            <DeliveryValueChart
              data={valueChartData}
              members={members}
              selectedUserId={selectedUserId}
            />
          </div>
        </div>
      )}
    </>
  );
}
