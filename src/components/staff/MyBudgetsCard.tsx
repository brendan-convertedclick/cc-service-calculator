import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RetainerBudgetBar } from "@/components/retainers/RetainerBudgetBar";
import { useAuth } from "@/context/AuthContext";
import { useRetainerBudget } from "@/hooks/useRetainerBudget";
import { currentBudgetMonth } from "@/lib/retainer-budget";
import { supabase } from "@/lib/supabase";

/** Retainers (project ids) where this person has open work: an open briefed task, or a provisioned task this month. */
function useMyRetainerIds(userId: string | null, month: string) {
  return useQuery({
    queryKey: ["my_retainer_ids", userId, month],
    enabled: !!userId,
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const [briefs, prov] = await Promise.all([
        supabase
          .from("briefs")
          .select("parent_project_id")
          .eq("assignee_id", userId!)
          .eq("status", "briefed")
          .not("parent_project_id", "is", null)
          .is("completed_at", null)
          .neq("billing_type", "adhoc")
          .or("clickup_task_status.is.null,clickup_task_status.neq.closed"),
        supabase
          .from("provisioned_tasks")
          .select("project_id")
          .eq("assignee_id", userId!)
          .gte("period_start", `${month}-01`)
          .lt("period_start", next),
      ]);
      if (briefs.error) throw briefs.error;
      if (prov.error) throw prov.error;
      const ids = new Set<string>();
      for (const r of briefs.data ?? []) if (r.parent_project_id) ids.add(r.parent_project_id as string);
      for (const r of prov.data ?? []) if (r.project_id) ids.add(r.project_id as string);
      return ids;
    },
  });
}

/** What each retainer the signed-in person works on has left this month. Open to every role. */
export function MyBudgetsCard() {
  const { currentUserId } = useAuth();
  const month = currentBudgetMonth();
  const budgets = useRetainerBudget(month);
  const mine = useMyRetainerIds(currentUserId, month);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(false);

  let body: ReactNode;
  if (budgets.isLoading || (currentUserId && mine.isLoading)) {
    body = <p className="text-body-small text-m-on-surface-variant">Loading budgets…</p>;
  } else if (budgets.isError || (currentUserId && mine.isError)) {
    body = <p className="text-body-small text-m-on-surface-variant">Couldn't load budgets.</p>;
  } else {
    const all = [...(budgets.data ?? [])].sort((a, b) => a.free - b.free);
    const ids = mine.data;
    const shared = !currentUserId;
    const mineList = shared ? all : all.filter((b) => ids?.has(b.projectId));
    const empty = !shared && mineList.length === 0;
    const list = shared || showAll ? all : mineList;
    const shown = expanded ? list : list.slice(0, 6);
    body = (
      <div className="space-y-4">
        {shared && (
          <p className="text-body-small text-m-on-surface-variant">
            Signed in with the shared login, so every retainer is shown.
          </p>
        )}
        {empty && (
          <p className="text-body-small text-m-on-surface-variant">You have no open work on a retainer this month.</p>
        )}
        {shown.map((b) => (
          <div key={b.projectId} className="space-y-1">
            <p className="text-label-large text-m-on-surface">{b.projectName}</p>
            <RetainerBudgetBar budget={b} />
          </div>
        ))}
        {list.length > shown.length && (
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Show {list.length - shown.length} more
          </Button>
        )}
        {!shared && (empty || mineList.length > 0) && (
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show mine" : "Show all retainers"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="shadow-elev-2">
      <CardHeader>
        <CardTitle className="text-headline-small">Budgets</CardTitle>
        <CardDescription>
          What each retainer you work on has left this month. Free is what anyone can still ask for.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
