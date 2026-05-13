import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefList } from "@/components/BriefList";
import { BriefConversation } from "@/components/BriefConversation";
import { InboxFilterPanel } from "@/components/InboxFilterPanel";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import { useBrief } from "@/hooks/useBriefs";
import { useInboxFilterTree } from "@/hooks/useInboxFilterTree";
import { useCurrentUserId } from "@/context/AuthContext";
import type { BriefScope, BriefFilterOptions } from "@/hooks/useBriefs";
import type { ClaudePrompt } from "@/types/claude";

const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const SCOPES: BriefScope[] = ["new", "mine", "unassigned", "waiting", "all"];

const TAB_LABEL: Record<BriefScope, string> = {
  new: "New",
  mine: "Mine",
  unassigned: "Unassigned",
  waiting: "Waiting",
  all: "All",
};

export function Inbox() {
  const { briefId } = useParams<{ briefId?: string }>();
  const currentUserId = useCurrentUserId();
  const navigate = useNavigate();
  const { data: selectedBrief } = useBrief(briefId);
  const { data: filterTree } = useInboxFilterTree();

  const defaultTab: BriefScope = "new";

  // undefined = no filter; null = unassigned; string = specific client
  const [activeClientId, setActiveClientId] = useState<string | null | undefined>(undefined);
  const [activeContactEmail, setActiveContactEmail] = useState<string | undefined>(undefined);

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

  const filterOptions: BriefFilterOptions | undefined =
    activeClientId !== undefined || activeContactEmail !== undefined
      ? { clientId: activeClientId, contactEmail: activeContactEmail }
      : undefined;

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
Notes: ${selectedBrief.am_notes ?? "(none)"}
Brief ID: ${selectedBrief.id}

${MCP_NOTE}

Action: Run /intake or /brief using the email thread above as context. Look up the client via find-client using the sender email or client name. Create or update a brief in cc-service-calculator with the relevant context, classify the intent, and generate a scope or draft reply as appropriate.

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
          <Button asChild>
            <Link to="/briefs/new">
              <Plus className="h-4 w-4" /> New brief
            </Link>
          </Button>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4">
            {SCOPES.map((scope) => (
              <TabsTrigger key={scope} value={scope}>
                {TAB_LABEL[scope]}
              </TabsTrigger>
            ))}
          </TabsList>

          {SCOPES.map((scope) => (
            <TabsContent key={scope} value={scope}>
              <BriefList
                scope={scope}
                currentUserId={currentUserId}
                selectedBriefId={briefId}
                filterOptions={filterOptions}
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
