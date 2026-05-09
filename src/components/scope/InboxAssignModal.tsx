import { useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useClientProjects } from "@/hooks/useClientProjects";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const intentLabels: Record<string, string> = {
  new_brief: "New brief",
  project_thread: "Project thread",
  retainer_thread: "Retainer thread",
  general_query: "Query",
  quick_response: "Quick response",
};

interface Props {
  brief: Brief;
  open: boolean;
  onClose: () => void;
}

export function InboxAssignModal({ brief, open, onClose }: Props) {
  const { data: clients = [] } = useClientProjects();
  const { mutateAsync, isPending } = useAssignBriefToProject();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const allProjects = clients.flatMap((c) =>
    c.projects.map((p) => ({ ...p, clientName: c.name }))
  );

  async function handleAssign() {
    if (!selectedProjectId) return;
    try {
      await mutateAsync({ briefId: brief.id, projectId: selectedProjectId });
      toast.success("Brief linked to project");
      setSelectedProjectId(null);
      onClose();
    } catch {
      toast.error("Failed to assign brief");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] max-w-full">
        <SheetHeader className="mb-6">
          <SheetTitle>{brief.raw_subject ?? "(no subject)"}</SheetTitle>
          <SheetDescription>
            From {brief.sender_email}
            {brief.intent_type && (
              <span className="ml-2 rounded px-2 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
                {intentLabels[brief.intent_type] ?? brief.intent_type}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mb-6">
          <h3 className="mb-3 text-label-large text-m-on-surface">Assign to project</h3>
          <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
            {allProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-3 text-left text-body-medium transition-colors",
                  selectedProjectId === p.id
                    ? "border-m-primary bg-m-primary-container text-m-on-primary-container"
                    : "border-m-outline-variant bg-m-surface text-m-on-surface hover:bg-m-surface-container"
                )}
              >
                <span className="flex-1">
                  {p.clientName} — {p.name}
                </span>
                <span className="shrink-0 text-label-small opacity-60">
                  {p.engagement_type}
                </span>
              </button>
            ))}
            {allProjects.length === 0 && (
              <p className="text-body-small text-m-on-surface-variant">
                No active projects. Create a project first.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleAssign}
            disabled={!selectedProjectId || isPending}
            className="flex-1"
          >
            {isPending ? "Assigning…" : "Assign to project"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
