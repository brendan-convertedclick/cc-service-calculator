import { Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import type { ChangeEstimateRow } from "@/types/change-estimates";

/**
 * Soft-gate banner shown when any CE on the project is in 'sent' status.
 */
export function PendingCEBanner({ projectId }: { projectId: string }) {
  const { data: pending } = useQuery({
    queryKey: ["change-estimates", projectId, "pending"],
    queryFn: async (): Promise<ChangeEstimateRow[]> => {
      const { data, error } = await supabase
        .from("change_estimates")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "sent")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChangeEstimateRow[];
    },
  });
  if (!pending || pending.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-title-small text-amber-900">
            Awaiting client approval
            <Badge variant="warning">{pending.length} CE</Badge>
          </div>
          <ul className="list-disc pl-5 text-body-small text-amber-900">
            {pending.map((ce) => (
              <li key={ce.id}>
                {ce.summary ?? "(no summary)"} —{" "}
                <span className="text-amber-800">
                  {ce.delta_points >= 0 ? "+" : ""}
                  {ce.delta_points} pts ·{" "}
                  {(ce.delta_value_cents / 100).toLocaleString("en-ZA", {
                    style: "currency",
                    currency: "ZAR",
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-label-small text-amber-800">
            Work isn't blocked, but new scope shouldn't be started until the
            client signs off.
          </p>
        </div>
      </div>
    </div>
  );
}
