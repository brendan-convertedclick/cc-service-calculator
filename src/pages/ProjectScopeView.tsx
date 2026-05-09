import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/hooks/useProjects";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { ActivityFeed } from "@/components/scope/ActivityFeed";
import { StatusStrip } from "@/components/scope/StatusStrip";
import { BriefConversation } from "@/components/BriefConversation";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

export function ProjectScopeView() {
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();

  const { data: clientsData = [] } = useClientProjects();
  const client = clientsData.find((c) => c.id === clientId);
  const projectMeta = client?.projects.find((p) => p.id === projectId);

  const { data: projectData, isLoading: projectLoading } = useProject(projectId);
  const project = projectData?.project;
  const actuals = projectData?.actuals ?? [];

  const { data: events = [], isLoading: activityLoading } = useProjectActivity(
    projectId,
    project?.quote_id ?? undefined
  );

  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);

  const briefEvents = events.filter((e) => e.type === "brief");
  const linkedBriefCount = briefEvents.length;
  const quoteEvent = events.find((e) => e.type === "quote");
  const activeQuote = quoteEvent?.type === "quote" ? quoteEvent.quote : null;
  const engagementType = project?.engagement_type ?? projectMeta?.engagement_type ?? "fixed";
  const scopeStatus = project?.scope_status ?? projectMeta?.scope_status ?? "on_track";
  const projectName = project?.name ?? projectMeta?.name ?? "Project";
  const clientName = client?.name ?? "Client";

  if (projectLoading) {
    return (
      <div className="flex h-full items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[1fr_280px]">
      {/* Centre pane */}
      <div className="flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-m-outline-variant bg-m-surface px-6 py-4">
          <Link
            to={`/clients/${clientId}`}
            className="text-body-medium text-m-on-surface-variant hover:text-m-on-surface transition-colors"
          >
            {clientName}
          </Link>
          <ChevronRight className="h-4 w-4 text-m-on-surface-variant" />
          <span className="text-body-medium text-m-on-surface">{projectName}</span>
          <span className="ml-2 rounded px-2 py-0.5 text-label-small bg-m-surface-container text-m-on-surface-variant">
            {engagementType}
          </span>
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-label-small",
              scopeStatusColor[scopeStatus] ?? "bg-m-surface-container text-m-on-surface-variant"
            )}
          >
            {scopeStatus.replace(/_/g, " ")}
          </span>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="inbox" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 justify-start rounded-none border-b border-m-outline-variant bg-m-surface px-6">
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="quote">Quote / SOW</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="flex-1 overflow-auto">
            {activityLoading ? (
              <div className="flex flex-col gap-4 p-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-m-surface-container" />
                ))}
              </div>
            ) : briefEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
                <p className="text-body-medium text-m-on-surface-variant">No messages yet</p>
                <p className="text-label-small text-m-on-surface-variant">
                  Emails linked to this project will appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-m-outline-variant">
                {briefEvents.map((e) => {
                  if (e.type !== "brief") return null;
                  const b = e.brief;
                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBrief(b)}
                      className="flex items-start gap-3 px-6 py-4 text-left transition-colors hover:bg-m-surface-container"
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-m-primary-container">
                        <Mail className="h-3.5 w-3.5 text-m-on-primary-container" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-body-medium text-m-on-surface">
                            {b.raw_subject ?? "(no subject)"}
                          </span>
                          {b.intent_type && (
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
                              {b.intent_type === "project_thread" ? "Project thread" : b.intent_type}
                            </span>
                          )}
                        </div>
                        <div className="text-label-small text-m-on-surface-variant">
                          {b.sender_email} · {new Date(e.timestamp).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="brief" className="flex-1 overflow-auto">
            {briefEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
                <p className="text-body-medium text-m-on-surface-variant">No briefs linked</p>
                <p className="text-label-small text-m-on-surface-variant">
                  Briefs assigned to this project will appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-m-outline-variant">
                {briefEvents.map((e) => {
                  if (e.type !== "brief") return null;
                  const b = e.brief;
                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBrief(b)}
                      className="flex items-start gap-3 px-6 py-4 text-left transition-colors hover:bg-m-surface-container"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-body-medium text-m-on-surface">
                          {b.raw_subject ?? "(no subject)"}
                        </div>
                        <div className="mt-0.5 text-label-small text-m-on-surface-variant">
                          {b.sender_email} · {new Date(e.timestamp).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                        {b.am_notes && (
                          <p className="mt-1 text-label-small text-m-on-surface-variant line-clamp-2">
                            {b.am_notes}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-label-small text-m-on-surface-variant">Open →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="flex-1 overflow-auto">
            <ActivityFeed events={events} isLoading={activityLoading} />
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              ClickUp task sync coming in a future phase.
            </p>
          </TabsContent>

          <TabsContent value="quote" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              {project?.quote_id
                ? `Linked to quote ${project.quote_id}.`
                : "No quote linked to this project yet."}
            </p>
          </TabsContent>

          <TabsContent value="time" className="flex-1 overflow-auto p-6">
            <p className="text-body-medium text-m-on-surface-variant">
              Time breakdown by department.
            </p>
          </TabsContent>
        </Tabs>

        {selectedBrief && (
          <BriefConversation
            brief={selectedBrief}
            open={!!selectedBrief}
            onClose={() => setSelectedBrief(null)}
          />
        )}
      </div>

      {/* Right pane */}
      <StatusStrip
        actuals={actuals}
        quote={activeQuote}
        briefCount={linkedBriefCount}
      />
    </div>
  );
}
