import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useRetainerBudget } from "@/hooks/useRetainerBudget";
import { currentBudgetMonth, type RetainerBudget } from "@/lib/retainer-budget";
import { RetainerBudgetBar } from "./RetainerBudgetBar";

/**
 * What the client's retainer has free, shown on the request forms before anyone asks for time.
 * Display only: it never touches submit, tier or payload.
 */
export function ClientBudgetPanel({
  clientId,
  clientName,
  clickupTaskId,
  askHours,
  onResolved,
}: {
  clientId: string;
  /** Used for the copy when the client has no budgets at all. */
  clientName?: string;
  clickupTaskId?: string | null;
  askHours: number;
  /** The retainer the picked task books to, or null when it cannot be placed. */
  onResolved?: (b: RetainerBudget | null) => void;
}) {
  const budgets = useRetainerBudget(currentBudgetMonth(), clientId);

  // Which retainer the picked task books to. A lookup error counts as unresolved, never blocks the form.
  const lookup = useQuery({
    queryKey: ["brief_project_by_task", clickupTaskId],
    enabled: !!clickupTaskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("parent_project_id")
        .eq("clickup_task_id", clickupTaskId!)
        .not("parent_project_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.parent_project_id as string | null) ?? null;
    },
  });

  const resolved =
    (clickupTaskId && lookup.data && budgets.data?.find((b) => b.projectId === lookup.data)) || null;
  useEffect(() => {
    onResolved?.(resolved);
  }, [resolved, onResolved]);

  if (budgets.isLoading || (clickupTaskId && lookup.isLoading)) return null;
  if (budgets.isError)
    return <p className="text-body-small text-m-on-surface-variant">Couldn't load the retainer budget.</p>;

  const all = budgets.data ?? [];
  const name = all[0]?.clientName ?? clientName ?? "this client";
  if (all.length === 0)
    return (
      <p className="text-body-small text-m-on-surface-variant">
        {clientName ? `${clientName} has no` : "This client has no"} retainer budget. This work is billed separately.
      </p>
    );

  const match = resolved ?? undefined;
  const shown = match ? [match] : all;

  return (
    <div className="space-y-3">
      {shown.map((b) => (
        <div key={b.projectId} className="space-y-1">
          <p className="text-label-large text-m-on-surface">{b.projectName}</p>
          <RetainerBudgetBar budget={b} askHours={askHours} />
        </div>
      ))}
      {clickupTaskId && !match && (
        <p className="text-body-small text-m-on-surface-variant">
          This task isn't linked to a retainer, so all of {name}'s retainers are shown.
        </p>
      )}
    </div>
  );
}
