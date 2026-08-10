import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useReconciliation,
  type ReconciliationRow,
} from "@/hooks/useReconciliation";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

function formatZAR(cents: number): string {
  return ZAR.format(cents / 100);
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
  });
}

const statusColor: Record<string, string> = {
  PAID: "bg-green-100 text-green-800",
  AUTHORISED: "bg-blue-100 text-blue-800",
  SUBMITTED: "bg-amber-100 text-amber-800",
  DRAFT: "bg-m-surface-container text-m-on-surface-variant",
  VOIDED: "bg-m-surface-container text-m-on-surface-variant",
  OVERDUE: "bg-red-100 text-red-800",
};

interface FlagChipProps {
  flag: ReconciliationRow["flags"][number];
}

function FlagChip({ flag }: FlagChipProps) {
  if (flag === "work_not_invoiced") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
        ⚠ Work not invoiced
      </span>
    );
  }
  if (flag === "invoice_overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
        🔴 Invoice overdue
      </span>
    );
  }
  if (flag === "no_actuals") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-m-surface-container px-2 py-0.5 text-[11px] font-medium text-m-on-surface-variant">
        ○ No actuals
      </span>
    );
  }
  return null;
}

interface DetailDrawerProps {
  row: ReconciliationRow;
  onClose: () => void;
}

function DetailDrawer({ row, onClose }: DetailDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="flex h-full w-[420px] flex-col border-l border-m-outline-variant bg-m-surface shadow-elev-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-m-outline-variant px-5 py-4">
          <div>
            <h2 className="text-title-medium text-m-on-surface">
              {row.clientName}
            </h2>
            <p className="mt-0.5 text-label-small text-m-on-surface-variant">
              {row.deliveredHours}h delivered · {formatZAR(row.costCents)} cost
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 flex flex-col gap-6">
          {/* Flags */}
          {row.flags.length > 0 && (
            <section>
              <h3 className="mb-2 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
                Flags
              </h3>
              <div className="flex flex-wrap gap-2">
                {row.flags.map((f) => (
                  <FlagChip key={f} flag={f} />
                ))}
              </div>
            </section>
          )}

          {/* Invoices */}
          <section>
            <h3 className="mb-2 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
              Invoices this month
            </h3>
            {row.invoices.length === 0 ? (
              <p className="text-body-small text-m-on-surface-variant">
                No invoices this month.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {row.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="rounded-lg border border-m-outline-variant bg-m-surface-container p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label-medium text-m-on-surface font-medium">
                        {inv.invoiceNumber ?? inv.xeroInvoiceId}
                      </span>
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-label-small",
                          statusColor[inv.status] ??
                            "bg-m-surface-container text-m-on-surface-variant",
                        )}
                      >
                        {inv.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-body-small text-m-on-surface-variant">
                        {formatZAR(inv.amountCents)}
                      </span>
                      {inv.dueDate && (
                        <span className="text-label-small text-m-on-surface-variant">
                          Due{" "}
                          {new Date(inv.dueDate).toLocaleDateString("en-ZA", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      )}
                    </div>
                    {inv.paidAt && (
                      <div className="mt-0.5 text-label-small text-green-700">
                        Paid{" "}
                        {new Date(inv.paidAt).toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Actuals summary */}
          <section>
            <h3 className="mb-2 text-label-large font-bold uppercase tracking-wide text-m-on-surface-variant">
              Actuals summary
            </h3>
            <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
              <div className="flex items-center justify-between">
                <span className="text-body-small text-m-on-surface-variant">
                  Hours delivered
                </span>
                <span className="text-label-medium text-m-on-surface">
                  {row.deliveredHours}h
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-body-small text-m-on-surface-variant">
                  Cost
                </span>
                <span className="text-label-medium text-m-on-surface">
                  {formatZAR(row.costCents)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-body-small text-m-on-surface-variant">
                  Invoiced
                </span>
                <span className="text-label-medium text-m-on-surface">
                  {formatZAR(row.invoicedCents)}
                </span>
              </div>
              {row.invoicedCents > 0 && row.costCents > 0 && (
                <div className="mt-1 flex items-center justify-between border-t border-m-outline-variant pt-1">
                  <span className="text-body-small text-m-on-surface-variant">
                    Variance
                  </span>
                  <span
                    className={cn(
                      "text-label-medium",
                      row.invoicedCents >= row.costCents
                        ? "text-green-700"
                        : "text-red-700",
                    )}
                  >
                    {formatZAR(row.invoicedCents - row.costCents)}
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function exportCSV(
  rows: ReconciliationRow[],
  year: number,
  month: number,
): void {
  const header = [
    "Client",
    "Hours Delivered",
    "Cost (ZAR)",
    "Invoiced (ZAR)",
    "Margin %",
    "Invoice Status",
    "Flags",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) => {
      const marginPct =
        r.invoicedCents > 0 && r.costCents > 0
          ? Math.round(
              ((r.invoicedCents - r.costCents) / r.invoicedCents) * 100,
            )
          : "";
      return [
        `"${r.clientName.replace(/"/g, '""')}"`,
        r.deliveredHours,
        (r.costCents / 100).toFixed(2),
        (r.invoicedCents / 100).toFixed(2),
        marginPct,
        r.invoiceStatus ?? "",
        `"${r.flags.join(", ")}"`,
      ].join(",");
    }),
  ];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const monthStr = String(month + 1).padStart(2, "0");
  a.href = url;
  a.download = `ops-snapshot-${year}-${monthStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReconciliationView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedRow, setSelectedRow] = useState<ReconciliationRow | null>(
    null,
  );

  const { data: rows = [], isLoading } = useReconciliation(year, month);

  const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
  const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

  const monthLabel = formatMonthLabel(year, month);

  const rowSummary = rows
    .map(
      (r) =>
        `- ${r.clientName}: ${r.deliveredHours}h delivered, invoiced R${(r.invoicedCents / 100).toFixed(2)}, cost R${(r.costCents / 100).toFixed(2)}${r.flags.length ? `, flags: ${r.flags.join(", ")}` : ""}`,
    )
    .join("\n");

  const reconPrompts: ClaudePrompt[] = [
    {
      id: "recon-explanation",
      label: "Recon explanation",
      build: () => `${ROLE}

Context:
Month: ${monthLabel}
Reconciliation data:
${rowSummary || "(no data)"}

${MCP_NOTE}

Action: Write a plain-English reconciliation explanation for ${monthLabel}. For each client with flags or notable variances, explain what happened and why (e.g. work not invoiced, invoice overdue, cost vs invoiced gap). Keep each client explanation to 2–3 sentences. Suitable for an internal debrief or client conversation.

Output: A markdown report with one section per flagged client, plus a one-paragraph overall summary.`,
    },
    {
      id: "invoice-line-items",
      label: "Invoice line items",
      build: () => `${ROLE}

Context:
Month: ${monthLabel}
Billable hours by client:
${rowSummary || "(no data)"}

${MCP_NOTE}

Action: Format the billable hours above as Xero-ready invoice line item descriptions for ${monthLabel}. For each client, produce: description (service type + period), quantity (hours), unit (hours), and amount note. Use professional billing language.

Output: A markdown table with columns: Client | Description | Hours | Notes. One row per client with delivered hours > 0.`,
    },
  ];

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const totalCost = rows.reduce((s, r) => s + r.costCents, 0);
  const totalInvoiced = rows.reduce((s, r) => s + r.invoicedCents, 0);
  const totalHours = rows.reduce((s, r) => s + r.deliveredHours, 0);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex h-full flex-col overflow-hidden bg-m-surface">
          {/* Page header */}
          <div className="flex shrink-0 items-center justify-between border-b border-m-outline-variant bg-m-surface px-6 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-headline-small text-m-on-surface">
                Invoice Reconciliation
              </h1>
              <div className="flex items-center gap-1 rounded-lg border border-m-outline-variant bg-m-surface-container px-1">
                <button
                  onClick={prevMonth}
                  aria-label="Previous month"
                  className="grid h-7 w-7 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface hover:text-m-on-surface transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[140px] text-center text-label-medium text-m-on-surface">
                  {formatMonthLabel(year, month)}
                </span>
                <button
                  onClick={nextMonth}
                  aria-label="Next month"
                  className="grid h-7 w-7 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface hover:text-m-on-surface transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(rows, year, month)}
              disabled={rows.length === 0}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Export snapshot
            </Button>
          </div>

          {/* Table area */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex flex-col gap-3 p-6">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-m-surface-container"
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <p className="text-body-medium text-m-on-surface-variant">
                  No data for this period
                </p>
                <p className="mt-1 text-label-small text-m-on-surface-variant">
                  Connect Xero and sync invoices to see reconciliation, or log
                  actuals against projects.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-m-outline-variant bg-m-surface-container">
                    <th className="px-6 py-3 text-label-small font-semibold text-m-on-surface-variant">
                      Client
                    </th>
                    <th className="px-4 py-3 text-label-small font-semibold text-m-on-surface-variant text-right">
                      Hours Delivered
                    </th>
                    <th className="px-4 py-3 text-label-small font-semibold text-m-on-surface-variant text-right">
                      Cost (ZAR)
                    </th>
                    <th className="px-4 py-3 text-label-small font-semibold text-m-on-surface-variant text-right">
                      Invoiced (ZAR)
                    </th>
                    <th className="px-4 py-3 text-label-small font-semibold text-m-on-surface-variant">
                      Invoice Status
                    </th>
                    <th className="px-6 py-3 text-label-small font-semibold text-m-on-surface-variant">
                      Flags
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.clientId}
                      onClick={() => setSelectedRow(row)}
                      className="cursor-pointer border-b border-m-outline-variant transition-colors hover:bg-m-surface-container"
                    >
                      <td className="px-6 py-3 text-body-medium text-m-on-surface font-medium">
                        {row.clientName}
                      </td>
                      <td className="px-4 py-3 text-body-medium text-m-on-surface text-right tabular-nums">
                        {row.deliveredHours > 0
                          ? `${row.deliveredHours}h`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-body-medium text-m-on-surface text-right tabular-nums">
                        {row.costCents > 0 ? formatZAR(row.costCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-body-medium text-m-on-surface text-right tabular-nums">
                        {row.invoicedCents > 0
                          ? formatZAR(row.invoicedCents)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.invoiceStatus ? (
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-label-small",
                              statusColor[row.invoiceStatus] ??
                                "bg-m-surface-container text-m-on-surface-variant",
                            )}
                          >
                            {row.invoiceStatus}
                          </span>
                        ) : (
                          <span className="text-label-small text-m-on-surface-variant">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.flags.map((f) => (
                            <FlagChip key={f} flag={f} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals footer */}
                <tfoot>
                  <tr className="border-t-2 border-m-outline-variant bg-m-surface-container">
                    <td className="px-6 py-3 text-label-medium font-bold text-m-on-surface">
                      Totals
                    </td>
                    <td className="px-4 py-3 text-label-medium font-bold text-m-on-surface text-right tabular-nums">
                      {Math.round(totalHours * 10) / 10}h
                    </td>
                    <td className="px-4 py-3 text-label-medium font-bold text-m-on-surface text-right tabular-nums">
                      {formatZAR(totalCost)}
                    </td>
                    <td className="px-4 py-3 text-label-medium font-bold text-m-on-surface text-right tabular-nums">
                      {formatZAR(totalInvoiced)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-label-small font-medium",
                          totalInvoiced >= totalCost && totalCost > 0
                            ? "bg-green-100 text-green-800"
                            : totalCost > 0
                              ? "bg-amber-100 text-amber-800"
                              : "bg-m-surface-container text-m-on-surface-variant",
                        )}
                      >
                        {totalCost > 0
                          ? `${totalInvoiced >= totalCost ? "+" : ""}${formatZAR(totalInvoiced - totalCost)} variance`
                          : "—"}
                      </span>
                    </td>
                    <td className="px-6 py-3" />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Detail drawer */}
          {selectedRow && (
            <DetailDrawer
              row={selectedRow}
              onClose={() => setSelectedRow(null)}
            />
          )}
        </div>
      </div>
      <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface">
        <ClaudePromptPanel prompts={reconPrompts} />
      </aside>
    </div>
  );
}
