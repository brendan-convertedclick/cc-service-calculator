import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUserId } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProblemCard } from "./ProblemCard";
import { EventTimeline } from "./EventTimeline";
import {
  useProjectProblems,
  useProjectEvents,
  useAcknowledgeProblem,
  useRunDetectorForProject,
} from "@/hooks/useProjectProblems";

/**
 * Phase 5 — Problems + Log tabs for a single project. Designed to slot
 * into ProjectDetail as a new tab section.
 */
export function ProjectProblemsTab({ projectId }: { projectId: string }) {
  const { data: problems, isLoading: pLoading } = useProjectProblems(projectId);
  const { data: events, isLoading: eLoading } = useProjectEvents(projectId);
  const ack = useAcknowledgeProblem();
  const runDetector = useRunDetectorForProject();
  const currentUserId = useCurrentUserId();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-title-medium">Problems & history</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={runDetector.isPending}
          onClick={async () => {
            try {
              await runDetector.mutateAsync(projectId);
              toast.success("Detector ran.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${runDetector.isPending ? "animate-spin" : ""}`} />
          {runDetector.isPending ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      <Tabs defaultValue="problems" className="space-y-4">
        <TabsList>
          <TabsTrigger value="problems">
            Problems · {problems?.length ?? 0}
          </TabsTrigger>
          <TabsTrigger value="log">Event log · {events?.length ?? 0}</TabsTrigger>
        </TabsList>

        <TabsContent value="problems" className="space-y-3">
          {pLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (problems ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-body-medium text-m-on-surface-variant">
                No active problems. ✨
              </CardContent>
            </Card>
          ) : (
            (problems ?? []).map((p) => (
              <ProblemCard
                key={p.id}
                problem={p}
                onAcknowledge={() =>
                  ack
                    .mutateAsync({ id: p.id, teamMemberId: currentUserId })
                    .then(() => toast.success("Acknowledged."))
                    .catch((e) =>
                      toast.error(e instanceof Error ? e.message : String(e)),
                    )
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="log" className="space-y-3">
          {eLoading ? <Skeleton className="h-40 w-full" /> : <EventTimeline events={events ?? []} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
