import { Link } from "react-router-dom";
import type { Database } from "@/types/db";
import type { ActivityEvent } from "@/hooks/useProjectActivity";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ActualRow = Database["public"]["Views"]["project_actuals_current"]["Row"];

export interface OverdueInvoice {
  invoiceNumber: string | null;
  dueDate: string;
  daysPastDue: number;
}

interface Props {
  project: Project;
  actuals: ActualRow[];
  events: ActivityEvent[];
  onDismiss: () => void;
  overdueInvoice?: OverdueInvoice | null;
}

export function RecommendedBanner({ project, actuals, events, onDismiss, overdueInvoice }: Props) {
  const messages: string[] = [];
  let quoteAction: { label: string; to: string } | null = null;
  let reconciliationAction: { label: string; to: string } | null = null;

  const totalActual = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
  const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);
  const burnPct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;

  if (burnPct >= 80) messages.push(`Budget at ${burnPct}% — consider scoping additional hours`);

  if (!project.quote_id) {
    messages.push("No quote linked to this project");
  } else {
    const quoteEvent = events.find((e) => e.type === "quote");
    if (quoteEvent?.type === "quote") {
      const status = quoteEvent.quote.status as string;
      if (status === "draft" || status === "sent") {
        messages.push("Quote not yet accepted");
        if (status === "sent") {
          quoteAction = { label: "View quote →", to: `/quotes/${quoteEvent.quote.id}` };
        } else {
          quoteAction = { label: "Send quote →", to: `/quotes/${quoteEvent.quote.id}/send` };
        }
      }
    }
  }

  if (project.scope_status === "overdue") messages.push("Project is overdue");

  if (overdueInvoice) {
    const label = overdueInvoice.invoiceNumber
      ? `Invoice overdue ${overdueInvoice.daysPastDue} days — ${overdueInvoice.invoiceNumber}`
      : `Invoice overdue ${overdueInvoice.daysPastDue} days`;
    messages.push(label);
    reconciliationAction = { label: "View reconciliation", to: "/reconciliation" };
  }

  const briefEvents = events.filter((e) => e.type === "brief");
  if (briefEvents.length > 0) {
    const latest = briefEvents[0];
    const daysSince = Math.floor(
      (Date.now() - new Date(latest.timestamp).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince >= 14) messages.push(`No brief activity in ${daysSince} days`);
  }

  if (messages.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2">
      <span className="text-label-small font-bold text-amber-700">⚡ Recommended</span>
      <span className="flex-1 text-label-small text-amber-800">{messages.join(" · ")}</span>
      {quoteAction && (
        <Link to={quoteAction.to} className="text-label-small text-amber-700 hover:underline">
          {quoteAction.label}
        </Link>
      )}
      {reconciliationAction && (
        <Link to={reconciliationAction.to} className="text-label-small text-amber-700 hover:underline">
          {reconciliationAction.label}
        </Link>
      )}
      <button
        aria-label="dismiss"
        onClick={onDismiss}
        className="text-label-small text-amber-600 hover:text-amber-700"
      >
        ×
      </button>
    </div>
  );
}
