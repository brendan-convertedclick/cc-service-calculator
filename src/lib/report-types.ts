// src/lib/report-types.ts
//
// The three Reports views the user picks between on the Reports page. The `id`
// is what lives in the URL (?type=) and on saved_reports.report_type.

export type ReportType = "invoice" | "scorecard" | "delays";

export interface ReportTypeDef {
  id: ReportType;
  label: string; // full name (chooser cards, saved-report badges)
  short: string; // compact name (the type switcher pills)
  description: string; // one-liner for the chooser cards
}

export const REPORT_TYPES: ReportTypeDef[] = [
  {
    id: "invoice",
    label: "Ad hoc invoice run",
    short: "Invoice",
    description: "Completed, un-invoiced ad hoc + project work for the period. Tick lines and export.",
  },
  {
    id: "scorecard",
    label: "Delivery scorecard",
    short: "Scorecard",
    description: "On-time rate, delivered / late / over-budget, and the open backlog.",
  },
  {
    id: "delays",
    label: "Delays: client vs internal",
    short: "Delays",
    description: "How much slippage is internal vs the client sitting on things — trended over time.",
  },
];

export const REPORT_TYPE_IDS = REPORT_TYPES.map((r) => r.id) as ReportType[];

export function isReportType(v: string | null | undefined): v is ReportType {
  return v != null && (REPORT_TYPE_IDS as string[]).includes(v);
}

export function reportTypeDef(id: string | null | undefined): ReportTypeDef | undefined {
  return REPORT_TYPES.find((r) => r.id === id);
}

export function reportTypeLabel(id: string | null | undefined): string {
  return reportTypeDef(id)?.label ?? "Report";
}
