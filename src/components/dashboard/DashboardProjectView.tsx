import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { ActivityFeed } from "@/components/scope/ActivityFeed";
import { StatusStrip } from "@/components/scope/StatusStrip";
import { RecommendedBanner, type OverdueInvoice } from "./RecommendedBanner";

function useOverdueInvoiceForClient(clientId: string | null | undefined): OverdueInvoice | null {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = useQuery({
    enabled: !!clientId,
    queryKey: ["overdueInvoice", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      try {
        const { data, error } = await supabase
          .from("xero_invoices")
          .select("invoice_number, due_date")
          .eq("client_id", clientId)
          .lt("due_date", today)
          .not("status", "in", '("PAID","VOIDED")')
          .order("due_date", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error || !data) return null;
        const daysPastDue = Math.floor(
          (Date.now() - new Date(data.due_date!).getTime()) / (1000 * 60 * 60 * 24)
        );
        return {
          invoiceNumber: data.invoice_number,
          dueDate: data.due_date!,
          daysPastDue,
        } satisfies OverdueInvoice;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? null;
}

const scopeStatusColor: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
};

function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase.functions.invoke("sync-clickup-actuals", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      return data as { inserted?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["clients", "withProjects"] });
      toast.success(`Synced — ${data?.inserted ?? 0} rows updated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

interface Props {
  projectId: string;
  clientName: string;
  onComplete: () => void;
}

export function DashboardProjectView({ projectId, clientName, onComplete }: Props) {
  const navigate = useNavigate();
  const { data, isLoading } = useProject(projectId);
  const { data: events = [], isLoading: activityLoading } = useProjectActivity(
    projectId,
    data?.project.quote_id ?? undefined
  );
  const sync = useSyncNow();
  const updateProject = useUpdateProject();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const overdueInvoice = useOverdueInvoiceForClient(data?.project.client_id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }

  if (!data) return null;

  const { project, actuals } = data;
  const quoteEvent = events.find((e): e is Extract<typeof e, { type: "quote" }> => e.type === "quote");
  const activeQuote = quoteEvent?.quote ?? null;
  const briefCount = events.filter((e) => e.type === "brief").length;
  const scopeStatus = project.scope_status ?? "on_track";

  function handleComplete() {
    if (!window.confirm(`Mark "${project.name ?? "Untitled project"}" as complete?`)) return;
    updateProject.mutate(
      { id: projectId, patch: { status: "completed" } },
      {
        onSuccess: () => {
          toast.success("Project marked complete");
          onComplete();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-m-outline-variant bg-m-surface px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-label-small px-2 py-0.5 rounded bg-m-surface-container border border-m-outline-variant">
              {project.project_code}
            </span>
            <span className="text-title-medium text-m-on-surface">
              {project.name ?? "Untitled project"}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-label-small",
                scopeStatusColor[scopeStatus] ?? "bg-m-surface-container text-m-on-surface-variant"
              )}
            >
              {scopeStatus.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">
            {clientName} · {project.engagement_type ?? "fixed"} · Started{" "}
            {new Date(project.started_at).toLocaleDateString("en-ZA")}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/briefs/new?projectId=${projectId}`)}
          >
            + Brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate(projectId)}
            disabled={sync.isPending}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleComplete}
            disabled={updateProject.isPending}
            className="text-green-700 border-green-300 hover:bg-green-50"
          >
            ✓ Complete
          </Button>
        </div>
      </div>

      {/* Recommended banner */}
      {!bannerDismissed && (
        <RecommendedBanner
          project={project}
          actuals={actuals}
          events={events}
          onDismiss={() => setBannerDismissed(true)}
          overdueInvoice={overdueInvoice}
        />
      )}

      {/* Tabs + StatusStrip */}
      <div className="flex flex-1 overflow-hidden">
        <Tabs defaultValue="activity" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 justify-start rounded-none border-b border-m-outline-variant bg-m-surface px-5">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="quote">Quote / SOW</TabsTrigger>
            <TabsTrigger value="time">Time</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="flex-1 overflow-auto">
            <ActivityFeed events={events} isLoading={activityLoading} />
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              ClickUp task sync coming in a future phase.
            </p>
          </TabsContent>

          <TabsContent value="quote" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              {project.quote_id
                ? `Linked to quote ${project.quote_id}.`
                : "No quote linked to this project yet."}
            </p>
          </TabsContent>

          <TabsContent value="time" className="flex-1 overflow-auto p-5">
            <p className="text-body-medium text-m-on-surface-variant">
              Time breakdown by department.
            </p>
          </TabsContent>
        </Tabs>

        <StatusStrip actuals={actuals} quote={activeQuote} briefCount={briefCount} />
      </div>
    </div>
  );
}
