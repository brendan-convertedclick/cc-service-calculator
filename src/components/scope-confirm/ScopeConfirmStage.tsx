import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeReceipt } from "@/components/scope-receipt/ScopeReceipt";
import { SowSelectionCard } from "@/components/scope-map/SowSelectionCard";
import { useServices } from "@/hooks/useServices";
import {
  useAnalyzeBrief,
  useClientSows,
  useOverridePlacement,
  useScopeMapPlacements,
  useUpdatePlacementValue,
  type AnalyzeBriefInput,
  type SowOption,
} from "@/hooks/useScopeMap";
import { useDepartments } from "@/hooks/useDepartments";
import {
  useAddLineTask,
  useDeleteLineTask,
  useLineTasks,
  useUpdateLineTask,
} from "@/hooks/usePlacementTasks";
import {
  PlacementTaskEditor,
  fmt,
} from "@/components/task-breakdown/PlacementTaskEditor";
import type { ReceiptCatalogService } from "@/lib/scope-receipt";
import type { Disposition } from "@/types/sow-placements";
import type { PlacementTask } from "@/types/placement-tasks";

interface Props {
  briefId: string;
  clientId: string | null | undefined;
  /** Whether Stage 1 has been confirmed (briefs.scope_confirmed_at set). */
  confirmed: boolean;
  /** True while the confirm mutation is in flight. */
  confirming: boolean;
  onConfirm: () => void;
  /** Advance to the next stage once scope is already confirmed. */
  onContinue?: () => void;
}

/**
 * Stage 1 of the brief flow: confirm what is In / New / Out of scope.
 *
 * Hosts the ScopeReceipt over brief_task_sow_placements. If no placements exist
 * yet it runs analyze-brief-sow (and asks which SOWs the client has when there's
 * no client→SOW link). Per-line In/New/Out corrections persist immediately; a
 * required "Confirm scope" click gates the rest of the flow.
 */
export function ScopeConfirmStage({
  briefId,
  clientId,
  confirmed,
  confirming,
  onConfirm,
  onContinue,
}: Props) {
  const placementsQuery = useScopeMapPlacements(briefId);
  const placements = placementsQuery.data;
  const clientSowsQuery = useClientSows(clientId);
  const analyze = useAnalyzeBrief(briefId);
  const override = useOverridePlacement(briefId);
  const updateValue = useUpdatePlacementValue(briefId);

  // Team task breakdown (Stage 1 drop-down per billable line → ClickUp).
  const tasksQuery = useLineTasks(briefId);
  const { data: departments } = useDepartments();
  const addTask = useAddLineTask(briefId);
  const updateTask = useUpdateLineTask(briefId);
  const deleteTask = useDeleteLineTask(briefId);

  const { data: services } = useServices();
  const serviceById = useMemo(
    () =>
      new Map<string, ReceiptCatalogService>(
        (services ?? []).map((s) => [
          s.id,
          {
            id: s.id,
            code: s.code,
            name: s.name,
            sell_price_cents: s.sell_price_cents,
            unit_of_sale: s.unit_of_sale,
          },
        ]),
      ),
    [services],
  );

  // task_ref → placement id, and placement id → its tasks, for the drop-down.
  const placementIdByTaskRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of placements ?? []) m.set(p.task_ref, p.id);
    return m;
  }, [placements]);

  const tasksByPlacement = useMemo(() => {
    const m = new Map<string, PlacementTask[]>();
    for (const t of tasksQuery.data ?? []) {
      const arr = m.get(t.placement_id);
      if (arr) arr.push(t);
      else m.set(t.placement_id, [t]);
    }
    return m;
  }, [tasksQuery.data]);

  const deptOptions = useMemo(
    () => (departments ?? []).map((d) => ({ id: d.id, name: d.name })),
    [departments],
  );

  // Render the team task breakdown for a billable line (its ClickUp tasks).
  const renderLineDetail = (taskRef: string) => {
    const placementId = placementIdByTaskRef.get(taskRef);
    if (!placementId) return null;
    const tasks = tasksByPlacement.get(placementId) ?? [];
    return (
      <PlacementTaskEditor
        tasks={tasks}
        departments={deptOptions}
        onAdd={() =>
          addTask.mutate(
            { placement_id: placementId, title: "", sort_order: tasks.length },
            {
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Failed to add task"),
            },
          )
        }
        onPatch={(id, patch) => updateTask.mutate({ id, patch })}
        onDelete={(id) => deleteTask.mutate(id)}
      />
    );
  };

  const lineSummary = (taskRef: string): ReactNode => {
    const placementId = placementIdByTaskRef.get(taskRef);
    if (!placementId) return undefined;
    const tasks = tasksByPlacement.get(placementId) ?? [];
    if (tasks.length === 0) return "+ Add team tasks";
    const h = tasks.reduce((s, t) => s + t.hours, 0);
    const p = tasks.reduce((s, t) => s + t.points, 0);
    return (
      <>
        {tasks.length} task{tasks.length === 1 ? "" : "s"} ·{" "}
        <span className="font-mono tabular-nums">{fmt(h)}</span>h ·{" "}
        <span className="font-mono tabular-nums">{fmt(p)}</span>pt
      </>
    );
  };

  const [selection, setSelection] = useState<{
    available: SowOption[];
    suggested: string[];
  } | null>(null);
  const autoRanRef = useRef(false);

  const runAnalyze = (input: AnalyzeBriefInput) => {
    setSelection(null);
    analyze.mutate(input, {
      onSuccess: (res) => {
        if (res.needs_sow_selection) {
          setSelection({ available: res.available, suggested: res.suggested_slugs });
          return;
        }
        toast.success(
          `Mapped ${res.placements.length} item(s) against ${res.sow_slugs.length} SOW(s).`,
        );
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Analysis failed"),
    });
  };

  // Auto-run the analysis exactly once when the brief loads with no placements.
  useEffect(() => {
    if (autoRanRef.current) return;
    if (placements === undefined) return;
    if (placements.length > 0) return;
    if (clientId && clientSowsQuery.isPending) return;
    autoRanRef.current = true;
    runAnalyze({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, clientId, clientSowsQuery.isPending]);

  const handleOverride = (ref: string, disposition: Disposition) => {
    const isInside = disposition === "in_agreed_scope";
    override.mutate(
      {
        task_ref: ref,
        is_inside: isInside,
        disposition,
        service_area_id: null,
        ...(isInside ? {} : { sow_slug: null }),
        override_reason: `Operator moved to ${disposition}`,
      },
      {
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Failed to update placement"),
      },
    );
  };

  const analyzing = analyze.isPending;
  const hasPlacements = (placements?.length ?? 0) > 0;

  // Error state — surface the read failure with a retry.
  if (placementsQuery.isError) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-body-medium text-destructive">Failed to load scope items.</p>
          <Button variant="outline" onClick={() => void placementsQuery.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // First load, before placements resolve.
  if (placements === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  // Client has no SOW link yet — ask which engagements they have.
  if (selection) {
    return (
      <SowSelectionCard
        available={selection.available}
        suggestedSlugs={selection.suggested}
        confirming={analyzing}
        onConfirm={(slugs) => runAnalyze({ sow_slugs: slugs, persist_client_sows: true })}
      />
    );
  }

  // Analysis running / imminent with nothing to show yet.
  if (!hasPlacements && (analyzing || analyze.isIdle)) {
    return (
      <Card className="border-m-outline-variant">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Sparkles className="h-7 w-7 animate-pulse text-m-primary" />
          <p className="text-body-medium text-m-on-surface">
            Extracting scope items and classifying them against the SOW…
          </p>
        </CardContent>
      </Card>
    );
  }

  // Analysis finished but produced nothing.
  if (!hasPlacements) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-body-medium text-m-on-surface-variant">
            {analyze.isError
              ? "Analysis failed. Fix the issue and try again."
              : "No scope items were extracted from this brief."}
          </p>
          <Button variant="outline" onClick={() => runAnalyze({})} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {analyze.isError ? "Run analysis" : "Re-run analysis"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-body-small text-m-on-surface-variant">
        Review how each request maps to the client&apos;s scope. Use the menu on any
        line to move it between <strong>In</strong>, <strong>New</strong> and{" "}
        <strong>Out</strong> if the classification is wrong.
      </p>

      <ScopeReceipt
        placements={placements}
        serviceById={serviceById}
        renderLineDetail={renderLineDetail}
        lineSummary={lineSummary}
        onOverride={handleOverride}
        onPersistQty={(ref, qty) =>
          updateValue.mutate(
            { task_ref: ref, quantity: qty },
            {
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Failed to update quantity"),
            },
          )
        }
        onPersistPrice={(ref, unitCents) =>
          updateValue.mutate(
            { task_ref: ref, estimated_cents: unitCents },
            {
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Failed to update price"),
            },
          )
        }
        onPersistName={(ref, name) =>
          updateValue.mutate(
            { task_ref: ref, item_name: name },
            {
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Failed to update title"),
            },
          )
        }
        onPersistDescription={(ref, description) =>
          updateValue.mutate(
            { task_ref: ref, item_description: description || null },
            {
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Failed to update description"),
            },
          )
        }
      />

      <div className="flex items-center justify-end gap-3 border-t border-m-outline-variant pt-4">
        {confirmed ? (
          <>
            <span className="flex items-center gap-1.5 text-body-small text-m-primary">
              <CheckCircle2 className="h-4 w-4" />
              Scope confirmed
            </span>
            {onContinue && (
              <Button variant="outline" onClick={onContinue} className="gap-2">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </>
        ) : (
          <Button onClick={onConfirm} disabled={confirming} className="gap-2">
            {confirming ? "Confirming…" : "Confirm scope →"}
          </Button>
        )}
      </div>
    </div>
  );
}
