import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefRow } from "@/components/BriefRow";
import { useBriefs } from "@/hooks/useBriefs";

export function Inbox() {
  const { data: newBriefs = [] } = useBriefs("new");
  const { data: needsInfo = [] } = useBriefs("needs_info");

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-headline-medium">Inbox</h1>
        <Button asChild>
          <Link to="/briefs/new">
            <Plus className="h-4 w-4" /> New brief
          </Link>
        </Button>
      </div>

      <h2 className="mb-2 text-title-medium">New ({newBriefs.length})</h2>
      <div className="space-y-2">
        {newBriefs.map((b) => <BriefRow key={b.id} brief={b} />)}
        {newBriefs.length === 0 && (
          <div className="text-body-medium text-m-on-surface-variant">Empty.</div>
        )}
      </div>

      {needsInfo.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-title-medium">Awaiting client ({needsInfo.length})</h2>
          <div className="space-y-2">
            {needsInfo.map((b) => <BriefRow key={b.id} brief={b} />)}
          </div>
        </>
      )}
    </div>
  );
}
