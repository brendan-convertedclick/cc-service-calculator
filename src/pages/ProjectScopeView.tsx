import { Link, useParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProject } from "@/hooks/useProjects";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { ActivityFeed } from "@/components/scope/ActivityFeed";
import { StatusStrip } from "@/components/scope/StatusStrip";

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

  const linkedBriefCount = events.filter((e) => e.type === "brief").length;
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
        <Tabs defaultValue="activity" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 justify-start rounded-none border-b border-m-outline-variant bg-m-surface px-6">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="quote">Quote / SOW</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>

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
      </div>

      {/* Right pane */}
      <StatusStrip
        actuals={actuals}
        quote={null}
        briefCount={linkedBriefCount}
      />
    </div>
  );
}
