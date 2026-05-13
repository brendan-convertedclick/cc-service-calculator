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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const clientsWithProjects = clients.filter((c) => c.projects.length > 0);
  const activeClient = clientsWithProjects.find((c) => c.id === selectedClientId) ?? null;
  const projects = activeClient?.projects ?? [];

  async function handleAssign() {
    if (!selectedProjectId) return;
    try {
      await mutateAsync({ briefId: brief.id, projectId: selectedProjectId });
      toast.success("Brief linked to project");
      setSelectedClientId(null);
      setSelectedProjectId(null);
      onClose();
    } catch {
      toast.error("Failed to assign brief");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[860px] sm:max-w-[90vw]">
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
          <div className="grid grid-cols-[260px_1fr] gap-6 max-h-[480px]">
            <div className="flex flex-col gap-1 overflow-y-auto border-r border-m-outline-variant pr-2">
              {clientsWithProjects.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedClientId(c.id);
                    setSelectedProjectId(null);
                  }}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-body-medium transition-colors",
                    selectedClientId === c.id
                      ? "bg-m-primary-container text-m-on-primary-container"
                      : "text-m-on-surface hover:bg-m-surface-container"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-label-small opacity-60">
                      {c.projects.length}
                    </span>
                  </div>
                </button>
              ))}
              {clientsWithProjects.length === 0 && (
                <p className="text-body-small text-m-on-surface-variant">
                  No clients with active projects.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 overflow-y-auto">
              {!activeClient && (
                <p className="text-body-small text-m-on-surface-variant">
                  Select a client to see their projects.
                </p>
              )}
              {activeClient && projects.length === 0 && (
                <p className="text-body-small text-m-on-surface-variant">
                  No active projects for this client.
                </p>
              )}
              {projects.map((p) => (
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
                  <span className="flex-1">{p.name}</span>
                  <span className="shrink-0 text-label-small opacity-60">
                    {p.engagement_type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedProjectId || isPending}
          >
            {isPending ? "Assigning…" : "Assign to project"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
