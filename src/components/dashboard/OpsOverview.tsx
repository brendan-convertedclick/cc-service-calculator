import { useMemo } from "react";
import type { OpsOverviewData } from "@/hooks/useOpsOverview";
import type { ClientWithProjects } from "@/hooks/useClientProjects";
import type { DeliveryRate } from "@/hooks/useDeliveryRate";
import type { DftCycleTime } from "@/hooks/useAvgDftCycleTime";
import { useDashboardView } from "@/hooks/useDashboardView";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
import type { ScopeFilter } from "./ProjectTree";
import { DashboardViewToggle } from "./DashboardViewToggle";
import { BentoOverview } from "./BentoOverview";
import { BoardOverview, type DeliveredProject } from "./BoardOverview";

interface Props {
  opsData: OpsOverviewData;
  clientsData: ClientWithProjects[];
  lastBriefActivity: Map<string, string>;
  onSelect: (id: string) => void;
  monthlyHours: number | null;
  deliveryRate: DeliveryRate | null;
  dftCycleTime: DftCycleTime | null;
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (f: ScopeFilter) => void;
}

export function OpsOverview({
  opsData,
  clientsData,
  lastBriefActivity,
  onSelect,
  monthlyHours,
  deliveryRate,
  dftCycleTime,
  scopeFilter,
  onScopeFilterChange,
}: Props) {
  const [view, setView] = useDashboardView();

  const today = new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Recently delivered = completed projects, newest first (Board "delivered" lane).
  const recentlyDelivered = useMemo<DeliveredProject[]>(
    () =>
      clientsData
        .flatMap((c) =>
          c.projects
            .filter((p) => p.status === "completed")
            .map((p) => ({
              id: p.id,
              name: p.name ?? "Untitled",
              clientName: c.name,
              engagementType: p.engagement_type ?? "fixed",
              completedAt: (p.completed_at as string | null) ?? p.started_at ?? null,
            })),
        )
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
        .slice(0, 12),
    [clientsData],
  );

  const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
  const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

  const projectSummary = opsData.projects
    .map(
      (p) =>
        `- ${p.clientName} / ${p.name} [${p.engagementType}]: ${p.scopeStatus.replace(/_/g, " ")}${p.reasonText ? ` — ${p.reasonText}` : ""}`,
    )
    .join("\n");

  const opsPrompts: ClaudePrompt[] = [
    {
      id: "health-narrative",
      label: "Health narrative",
      build: () => `${ROLE}

Context:
Date: ${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
Monthly hours burned: ${monthlyHours ?? "(loading)"}h
Delivery rate: ${deliveryRate ? `${deliveryRate.rate}%` : "(loading)"}
Avg DFT cycle time: ${dftCycleTime ? `${dftCycleTime.avgDays} days` : "(loading)"}

Projects:
${projectSummary || "(none)"}

${MCP_NOTE}

Action: Write a plain-English weekly ops summary suitable for a team standup or internal report. Cover: overall capacity health, projects needing attention, delivery performance, and 1–2 recommended actions. Keep it under 300 words.

Output: A formatted weekly ops summary in markdown, with sections: Overview, Projects Needing Attention, Performance Metrics, Recommended Actions.`,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-m-surface">
      {/* Shared header */}
      <header className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
        <div>
          <h1 className="text-headline-small text-m-on-surface">Operations overview</h1>
          <p className="mt-1 text-body-small text-m-on-surface-variant">
            {today} · {opsData.totalActiveProjects} active project{opsData.totalActiveProjects !== 1 ? "s" : ""} across{" "}
            {opsData.totalActiveClients} client{opsData.totalActiveClients !== 1 ? "s" : ""}
          </p>
        </div>
        <DashboardViewToggle view={view} onChange={setView} />
      </header>

      {/* Active view */}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "bento" ? (
          <BentoOverview
            opsData={opsData}
            monthlyHours={monthlyHours}
            deliveryRate={deliveryRate}
            dftCycleTime={dftCycleTime}
            scopeFilter={scopeFilter}
            onScopeFilterChange={onScopeFilterChange}
            onSelect={onSelect}
          />
        ) : (
          <BoardOverview
            opsData={opsData}
            monthlyHours={monthlyHours}
            deliveryRate={deliveryRate}
            dftCycleTime={dftCycleTime}
            recentlyDelivered={recentlyDelivered}
            lastBriefActivity={lastBriefActivity}
            onSelect={onSelect}
          />
        )}
      </div>

      <ClaudePromptPanel prompts={opsPrompts} />
    </div>
  );
}
