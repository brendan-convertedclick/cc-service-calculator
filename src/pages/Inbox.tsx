import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefList } from "@/components/BriefList";
import { BriefConversation } from "@/components/BriefConversation";
import { InboxFilterPanel } from "@/components/InboxFilterPanel";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import {
  PIPELINE_STATUSES,
  StatusPipeline,
  type PipelineSelection,
} from "@/components/briefs/StatusPipeline";
import { useBrief, useBriefs, useCreateBrief } from "@/hooks/useBriefs";
import { useBriefIntelligence } from "@/hooks/useBriefIntelligence";
import { useInboxFilterTree } from "@/hooks/useInboxFilterTree";
import { useCurrentUserId } from "@/context/AuthContext";
import type { BriefScope, BriefFilterOptions, BriefSortDirection } from "@/hooks/useBriefs";
import type { BriefStatus } from "@/lib/brief-routing";
import type { ClaudePrompt } from "@/types/claude";

const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const SCOPES: BriefScope[] = ["all", "new", "mine", "unassigned", "waiting", "archived"];

// Inbox only ever renders the primary pipeline pills (no delivery/execution-bucket
// filter here — that's Briefs.tsx's DeliveryFilter), so narrow the widely-typed
// PipelineSelection down before it reaches the brief-status DB filter.
function isPipelineBriefStatus(s: PipelineSelection): s is BriefStatus {
  return (PIPELINE_STATUSES as string[]).includes(s);
}

const TAB_LABEL: Record<BriefScope, string> = {
  new: "New",
  mine: "Mine",
  unassigned: "Unassigned",
  waiting: "Waiting",
  all: "All",
  archived: "Archived",
};

export function Inbox() {
  const { briefId } = useParams<{ briefId?: string }>();
  const currentUserId = useCurrentUserId();
  const navigate = useNavigate();
  const { data: selectedBrief } = useBrief(briefId);
  const { data: selectedBriefIntel } = useBriefIntelligence(briefId);
  const createBrief = useCreateBrief();
  const { data: filterTree } = useInboxFilterTree();

  const defaultTab: BriefScope = "all";

  // undefined = no filter; null = unassigned; string = specific client
  const [activeClientId, setActiveClientId] = useState<string | null | undefined>(undefined);
  const [activeContactEmail, setActiveContactEmail] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<BriefSortDirection>("desc");
  const [pipelineStatus, setPipelineStatus] = useState<PipelineSelection>("all");

  function handleSelectAll() {
    setActiveClientId(undefined);
    setActiveContactEmail(undefined);
  }

  function handleSelectClient(clientId: string) {
    setActiveClientId(clientId);
    setActiveContactEmail(undefined);
  }

  function handleSelectContact(clientId: string, email: string) {
    setActiveClientId(clientId);
    setActiveContactEmail(email);
  }

  function handleSelectUnassigned() {
    setActiveClientId(null);
    setActiveContactEmail(undefined);
  }

  const pipelineBriefStatus = isPipelineBriefStatus(pipelineStatus) ? pipelineStatus : undefined;

  const filterOptions: BriefFilterOptions | undefined =
    activeClientId !== undefined ||
    activeContactEmail !== undefined ||
    pipelineBriefStatus !== undefined
      ? {
          clientId: activeClientId,
          contactEmail: activeContactEmail,
          status: pipelineBriefStatus,
        }
      : undefined;

  // Pipeline counts: the full non-archived population under the current
  // client/contact filter, regardless of the scope tab or status selection.
  const { data: pipelinePopulation = [] } = useBriefs("all", currentUserId, {
    clientId: activeClientId,
    contactEmail: activeContactEmail,
  });
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<BriefStatus, number>> = {};
    for (const b of pipelinePopulation) {
      const s = b.status as BriefStatus;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [pipelinePopulation]);

  // Heading breadcrumb
  const filterLabel = activeContactEmail
    ? activeContactEmail
    : activeClientId === null
    ? "Unassigned"
    : activeClientId !== undefined && filterTree
    ? filterTree.clients.find((c) => c.id === activeClientId)?.name
    : undefined;

  const inboxPrompts: ClaudePrompt[] = selectedBrief
    ? [
        {
          id: "brief-from-email",
          label: "Brief from email",
          build: () => `${ROLE}

Context:
Subject: ${selectedBrief.raw_subject ?? "(no subject)"}
From: ${selectedBrief.sender_email ?? "(unknown)"}
Notes: ${selectedBriefIntel?.am_notes ?? "(none)"}
Brief ID: ${selectedBrief.id}

${MCP_NOTE}

Action: Run /intake or /brief using the email thread above as context. Look up the client via find-client using the sender email or client name. Create or update a brief in Conductor with the relevant context, classify the intent, and generate a scope or draft reply as appropriate.

Output: Confirmation of brief created or updated, with intent classification and any generated scope lines or draft reply.`,
        },
      ]
    : [];

  return (
    <div className="flex h-full">
      {/* Filter panel */}
      {filterTree && (
        <InboxFilterPanel
          tree={filterTree}
          activeClientId={activeClientId}
          activeContactEmail={activeContactEmail}
          onSelectAll={handleSelectAll}
          onSelectClient={handleSelectClient}
          onSelectContact={handleSelectContact}
          onSelectUnassigned={handleSelectUnassigned}
        />
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-end justify-between">
          <h1 className="text-headline-medium">
            Inbox
            {filterLabel && (
              <span className="ml-2 text-title-medium text-m-primary">· {filterLabel}</span>
            )}
          </h1>
          <Button
            disabled={createBrief.isPending}
            onClick={() =>
              createBrief
                .mutateAsync({
                  source: "manual",
                  status: "new",
                  raw_subject: null,
                  raw_body: "",
                })
                .then((b) => navigate(`/briefs/${b.id}/scope`))
                .catch(() => toast.error("Failed to create the brief"))
            }
          >
            <Plus className="h-4 w-4" /> {createBrief.isPending ? "Creating…" : "New brief"}
          </Button>
        </div>

        <StatusPipeline
          counts={statusCounts}
          active={pipelineStatus}
          onSelect={setPipelineStatus}
          className="mb-4"
        />

        <Tabs defaultValue={defaultTab}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <TabsList>
              {SCOPES.map((scope) => (
                <TabsTrigger key={scope} value={scope}>
                  {TAB_LABEL[scope]}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSortDirection((d) => (d === "desc" ? "asc" : "desc"))}
              title={
                sortDirection === "desc"
                  ? "Newest first (last message). Click to reverse."
                  : "Oldest first (last message). Click to reverse."
              }
              aria-label="Toggle sort order"
            >
              {sortDirection === "desc" ? (
                <ArrowDownWideNarrow className="h-4 w-4" />
              ) : (
                <ArrowUpWideNarrow className="h-4 w-4" />
              )}
            </Button>
          </div>

          {SCOPES.map((scope) => (
            <TabsContent key={scope} value={scope}>
              <BriefList
                scope={scope}
                currentUserId={currentUserId}
                selectedBriefId={briefId}
                filterOptions={filterOptions}
                sortDirection={sortDirection}
              />
            </TabsContent>
          ))}
        </Tabs>

        {selectedBrief && (
          <BriefConversation
            brief={selectedBrief}
            open={!!briefId}
            onClose={() => navigate("/inbox")}
          />
        )}
      </div>

      {selectedBrief && (
        <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface overflow-y-auto">
          <ClaudePromptPanel prompts={inboxPrompts} />
        </aside>
      )}
    </div>
  );
}
