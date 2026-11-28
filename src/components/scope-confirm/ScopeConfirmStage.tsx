import { useMemo, type ReactNode } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeReceipt } from "@/components/scope-receipt/ScopeReceipt";
import { AddBillableLine } from "@/components/scope-receipt/AddBillableLine";
import { errorMessage } from "@/lib/utils";
import { useServices } from "@/hooks/useServices";
import {
  useAddPlacement,
  useOverridePlacement,
  useScopeMapPlacements,
  useUpdatePlacementValue,
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
 * Hosts the ScopeReceipt over brief_task_sow_placements. Lines are added by
 * hand from the service catalogue: nothing reads the client's email to guess
 * them (the Brief Team artifact drafts briefs now). Per-line In/New/Out
 * corrections persist immediately; a
 * required "Confirm scope" click gates the rest of the flow.
 */
export function ScopeConfirmStage({
  briefId,
  confirmed,
  confirming,
  onConfirm,
  onContinue,
}: Props) {
  const placementsQuery = useScopeMapPlacements(briefId);
  const placements = placementsQuery.data;
  const override = useOverridePlacement(briefId);
  const updateValue = useUpdatePlacementValue(briefId);
  const addPlacement = useAddPlacement(briefId);

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
                toast.error(`Failed to add task: ${errorMessage(e)}`),
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
          toast.error(`Failed to update placement: ${errorMessage(e)}`),
      },
    );
  };

  // Seed a new billable line from a picked catalogue service. serviceById is
  // populated for every catalogue service; a just-created (inline) service may
  // lag a refetch, so guard rather than insert a nameless line.
  const handleAddLine = (serviceId: string) => {
    const svc = serviceById.get(serviceId);
    if (!svc) {
      toast.error("That service isn't loaded yet — pick it again from the list.");
      return;
    }
    addPlacement.mutate(
      {
        suggested_service_id: svc.id,
        item_name: svc.name,
        estimated_cents: svc.sell_price_cents,
      },
      {
        onError: (e) =>
          toast.error(`Failed to add billable line: ${errorMessage(e)}`),
      },
    );
  };

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

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-body-small text-m-on-surface-variant">
        Add each thing this brief asks for from the service catalogue, then use the
        menu on any line to move it between <strong>In</strong>, <strong>New</strong>{" "}
        and <strong>Out</strong> of the client&apos;s scope.
      </p>

      <ScopeReceipt
        placements={placements}
        serviceById={serviceById}
        renderLineDetail={renderLineDetail}
        lineSummary={lineSummary}
        addBillableLine={
          <AddBillableLine onPick={handleAddLine} pending={addPlacement.isPending} />
        }
        onOverride={handleOverride}
        onPersistQty={(ref, qty) =>
          updateValue.mutate(
            { task_ref: ref, quantity: qty },
            {
              onError: (e) =>
                toast.error(`Failed to update quantity: ${errorMessage(e)}`),
            },
          )
        }
        onPersistPrice={(ref, unitCents) =>
          updateValue.mutate(
            { task_ref: ref, estimated_cents: unitCents },
            {
              onError: (e) =>
                toast.error(`Failed to update price: ${errorMessage(e)}`),
            },
          )
        }
        onPersistName={(ref, name) =>
          updateValue.mutate(
            { task_ref: ref, item_name: name },
            {
              onError: (e) =>
                toast.error(`Failed to update title: ${errorMessage(e)}`),
            },
          )
        }
        onPersistDescription={(ref, description) =>
          updateValue.mutate(
            { task_ref: ref, item_description: description || null },
            {
              onError: (e) =>
                toast.error(`Failed to update description: ${errorMessage(e)}`),
            },
          )
        }
        onPersistReason={(ref, reason) =>
          updateValue.mutate(
            { task_ref: ref, client_reason: reason || null },
            {
              onError: (e) =>
                toast.error(`Failed to update reason: ${errorMessage(e)}`),
            },
          )
        }
        onToggleExcluded={(ref, excluded) =>
          updateValue.mutate(
            { task_ref: ref, excluded },
            {
              onError: (e) =>
                toast.error(`Failed to update line: ${errorMessage(e)}`),
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
