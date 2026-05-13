import { useProjectProfitability } from "@/hooks/useProjectProfitability";
import { ProfitabilityTable } from "./ProfitabilityTable";

function formatZar(cents: number): string {
  return Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function ProfitabilityTab() {
  const { data: rows = [], isLoading, isError } = useProjectProfitability();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-medium text-destructive">
        Failed to load profitability data.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-body-medium text-m-on-surface-variant text-center py-12">
        No active projects found. Projects appear here once a quote is accepted and moved to in progress.
      </p>
    );
  }

  const totalQuotedCents = rows.reduce((sum, r) => sum + r.quotedCents, 0);
  const totalMarginCents = rows.reduce((sum, r) => sum + r.marginCents, 0);
  const portfolioMargin =
    totalQuotedCents === 0
      ? "—"
      : formatPct((totalMarginCents / totalQuotedCents) * 100);

  // rows are sorted desc by marginPct already
  const bestRow = rows[0];

  const redRow = rows.find((r) => r.rag === "red") ?? rows[rows.length - 1];

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Portfolio Margin */}
        <div className="bg-m-surface rounded-xl p-4 border border-m-outline-variant">
          <p className="text-headline-medium text-m-on-surface">{portfolioMargin}</p>
          <p className="text-label-medium text-m-on-surface-variant">Portfolio Margin</p>
          <p className="text-body-medium text-m-on-surface-variant mt-1">
            across {rows.length} active project{rows.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Total Quoted */}
        <div className="bg-m-surface rounded-xl p-4 border border-m-outline-variant">
          <p className="text-headline-medium text-m-on-surface">{formatZar(totalQuotedCents)}</p>
          <p className="text-label-medium text-m-on-surface-variant">Total Quoted</p>
          <p className="text-body-medium text-m-on-surface-variant mt-1">in active pipeline</p>
        </div>

        {/* Best Margin */}
        <div className="bg-m-surface rounded-xl p-4 border border-m-outline-variant border-l-4 border-l-green-600">
          <p className="text-headline-medium text-m-on-surface">{bestRow.marginPct != null ? formatPct(bestRow.marginPct) : "—"}</p>
          <p className="text-label-medium text-m-on-surface-variant">{bestRow.projectName}</p>
          <p className="text-body-medium text-m-on-surface-variant mt-1">highest margin project</p>
        </div>

        {/* Needs Attention */}
        <div className="bg-m-surface rounded-xl p-4 border border-m-outline-variant border-l-4 border-l-red-700">
          <p className="text-headline-medium text-m-on-surface">{redRow.marginPct != null ? formatPct(redRow.marginPct) : "—"}</p>
          <p className="text-label-medium text-m-on-surface-variant">{redRow.projectName}</p>
          <p className="text-body-medium text-m-on-surface-variant mt-1">needs attention</p>
        </div>
      </div>

      <ProfitabilityTable rows={rows} />
    </div>
  );
}
