import { useNavigate, useParams, Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefList } from "@/components/BriefList";
import { BriefConversation } from "@/components/BriefConversation";
import { useBrief } from "@/hooks/useBriefs";
import { useCurrentUserId } from "@/context/AuthContext";
import type { BriefScope } from "@/hooks/useBriefs";

const SCOPES: BriefScope[] = ["mine", "unassigned", "waiting", "all"];

const TAB_LABEL: Record<BriefScope, string> = {
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

  const defaultTab: BriefScope = currentUserId ? "mine" : "all";

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
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
  );
}
