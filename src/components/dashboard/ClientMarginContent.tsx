import { cn } from "@/lib/utils";
import { useClientMargin } from "@/hooks/useClientMargin";
import { fmtZAR, ragDot } from "./dashboardFormat";

/** Scale used by the bar variant: a 50% margin fills the bar. */
const BAR_SCALE = 50;
function scale(pct: number) {
  return Math.max(0, Math.min(100, (pct / BAR_SCALE) * 100));
}

const ragFill: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
};
const ragText: Record<string, string> = {
  green: "text-green-700",
  amber: "text-amber-700",
  red: "text-red-700",
};

function vsTarget(marginPct: number | null, targetPct: number): string {
  if (marginPct === null) return `target ${targetPct}%`;
  const delta = marginPct - targetPct;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`;
}

function NotConnected() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
      <div className="flex-1">
        <p className="text-label-medium text-m-on-surface">Xero not connected</p>
        <p className="text-label-small text-m-on-surface-variant">Connect Xero to see margin.</p>
      </div>
      <a
        href="/settings?connect=xero"
        className="shrink-0 rounded-md bg-gradient-brand px-3 py-1.5 text-label-small font-semibold text-white transition-all hover:brightness-110"
      >
        Connect
      </a>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-label-small text-m-on-surface-variant">{children}</p>;
}

interface Props {
  variant: "bars" | "rows";
}

/**
 * Renders the rolling-30-day client-margin data, handling every state
 * (loading, Xero not connected, no invoices, empty). Used by both the Bento
 * margin tile (`bars`) and the Board margin lane (`rows`).
 */
export function ClientMarginContent({ variant }: Props) {
  const { data, isLoading, connectionStatus, hasInvoices } = useClientMargin();

  if (isLoading) return <Empty>Loading margin…</Empty>;
  if (!connectionStatus?.connected) return <NotConnected />;
  if (!hasInvoices)
    return (
      <Empty>
        No invoices synced —{" "}
        <a href="/settings" className="underline">
          sync from Settings
        </a>
        .
      </Empty>
    );
  if (!data || data.length === 0) return <Empty>No margin data for the last 30 days.</Empty>;

  if (variant === "rows") {
    return (
      <div className="flex flex-col gap-2">
        {data.map((row) => (
          <button
            key={row.clientId}
            type="button"
            className="flex items-center gap-2.5 rounded-lg border border-m-outline-variant bg-m-surface px-2.5 py-2 text-left transition-colors hover:bg-m-surface-container"
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", ragDot[row.rag] ?? "bg-gray-400")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label-medium font-semibold text-m-on-surface">
                {row.clientName}
              </span>
              <span className="block text-[10px] tabular-nums text-m-on-surface-variant">
                <span className="font-mono">{fmtZAR(row.revenueCents)}</span> rev
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("block text-label-medium font-bold font-mono tabular-nums", ragText[row.rag])}>
                {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : "—"}
              </span>
              <span className="block text-[10px] font-medium tabular-nums text-m-on-surface-variant">
                {vsTarget(row.marginPct, row.targetPct)}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  // variant === "bars"
  return (
    <div className="flex flex-col gap-3">
      {data.map((row) => (
        <div key={row.clientId}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-label-medium font-semibold text-m-on-surface">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", ragDot[row.rag] ?? "bg-gray-400")} />
              <span className="truncate">{row.clientName}</span>
            </span>
            <span className="shrink-0 text-[10px] font-mono tabular-nums text-m-on-surface-variant">
              {fmtZAR(row.revenueCents)}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-m-surface-container-highest">
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full", ragFill[row.rag] ?? "bg-gray-400")}
              style={{ width: `${row.marginPct !== null ? scale(row.marginPct) : 0}%` }}
            />
            <div
              className="absolute inset-y-[-2px] w-0.5 rounded-sm bg-m-on-surface/55"
              style={{ left: `${scale(row.targetPct)}%` }}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cn("text-label-small font-bold font-mono tabular-nums", ragText[row.rag])}>
              {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : "—"}
            </span>
            <span className="text-[10px] text-m-on-surface-variant">
              vs target {vsTarget(row.marginPct, row.targetPct)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
