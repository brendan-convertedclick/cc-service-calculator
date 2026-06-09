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
import { WorkflowTimeline } from "@/components/workflow/WorkflowTimeline";
import type { ClaudePrompt } from "@/types/claude";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-m-tertiary-container text-m-on-tertiary-container",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-m-error-container text-m-on-error-container",
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

  const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;
  const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;

  const totalUsed = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
  const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);

  const latestBrief = briefEvents[briefEvents.length - 1];
  const latestBriefSummary = latestBrief?.type === "brief"
    ? `Subject: ${latestBrief.brief.raw_subject ?? "(no subject)"}\nFrom: ${latestBrief.brief.sender_email ?? ""}\nNotes: ${latestBrief.brief.am_notes ?? "(none)"}`
    : "(none)";

  const quoteServices = activeQuote
    ? `Quote total: R${((activeQuote.total_cents ?? 0) / 100).toFixed(2)}\nQuote status: ${activeQuote.status}`
    : "No quote linked";

  const recentActivity = events
    .slice(-3)
    .map((e) => {
      if (e.type === "brief") return `Brief: ${e.brief.raw_subject ?? "(no subject)"}`;
      if (e.type === "quote") return `Quote: ${e.quote.status}`;
      return e.type;
    })
    .join("\n");

  const scopePrompts: ClaudePrompt[] = [
    {
      id: "draft-sow",
      label: "Draft SoW",
      build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Linked briefs: ${linkedBriefCount}
Latest brief:
${latestBriefSummary}

${MCP_NOTE}

Action: Run /sow new-project to generate a scope of work for this project. Use the client name and project name to look up relevant briefs via list-briefs and get-brief. Use the engagement type and quote context to inform scope tier and deliverables.

Output: A complete scope of work document ready for client review, formatted as markdown.`,
    },
    {
      id: "client-update",
      label: "Client update",
      build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
Scope status: ${scopeStatus.replace(/_/g, " ")}
Hours used: ${totalUsed}h of ${totalPlanned}h planned
Linked briefs: ${linkedBriefCount}
Recent activity:
${recentActivity || "(none)"}

${MCP_NOTE}

Action: Draft a concise, professional client-facing status update email for this project. Use the scope status, hours burned, and recent activity as the basis. Tone should be confident and transparent.

Output: A ready-to-send email with subject line and body. No placeholders.`,
    },
    {
      id: "brief-tasks",
      label: "Brief tasks",
      build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Latest brief:
${latestBriefSummary}

${MCP_NOTE}

Action: Run /brief to issue ClickUp tasks for the deliverables in the latest brief. Look up the client via find-client to get the client ID. Use the brief subject and notes to infer task names, descriptions, and assignees. Engagement type is "${engagementType}".

Output: Confirmation of tasks created in ClickUp with task IDs.`,
    },
    ...(linkedBriefCount > 0
      ? [
          {
            id: "scope-amendment",
            label: "Scope amendment",
            build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Latest brief (change request):
${latestBriefSummary}

${MCP_NOTE}

Action: Run /sow edit to produce an amended scope of work incorporating the change request in the latest brief. Include a change log section listing what was added, removed, or modified. Preserve the original scope structure.

Output: An updated scope of work document with a "Change log" section appended.`,
          } as ClaudePrompt,
        ]
      : []),
  ];

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
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
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

          <TabsContent value="workflow" className="flex-1 overflow-auto">
            {projectId && (
              <WorkflowTimeline
                projectId={projectId}
                projectName={projectName}
              />
            )}
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
        prompts={scopePrompts}
      />
    </div>
  );
}
