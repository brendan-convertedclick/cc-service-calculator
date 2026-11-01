import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { summariseBudget, type BudgetRow, type RetainerBudget } from "@/lib/retainer-budget";

// retainer_budget is not in the generated db types yet, so the rpc is untyped here.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: BudgetRow[] | null; error: Error | null }>;

/** Budget / Spent / To do / Free per retainer for a SAST "YYYY-MM" month, optionally one client. */
export function useRetainerBudget(month: string, clientId?: string | null) {
  return useQuery<RetainerBudget[]>({
    queryKey: ["retainer_budget", month, clientId ?? null],
    queryFn: async () => {
      const { data, error } = await rpc("retainer_budget", {
        p_month: month,
        p_client_id: clientId ?? null,
      });
      if (error) throw error;
      return summariseBudget(data ?? []);
    },
  });
}
