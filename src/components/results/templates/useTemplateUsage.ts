// src/components/results/templates/useTemplateUsage.ts
//
// How many groups/rows point at a template — shown in the template list and
// editor header if cheap to know, nothing guessed otherwise. Two head-count
// queries, no rows fetched.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

export function useTemplateUsage(templateId: string | undefined) {
  return useQuery({
    queryKey: ["results-template-usage", templateId ?? ""],
    enabled: !!templateId,
    queryFn: async (): Promise<number> => {
      const [groups, rows] = await Promise.all([
        supabase.from("results_groups").select("id", { count: "exact", head: true }).eq("template_id", templateId!),
        supabase.from("results_rows").select("id", { count: "exact", head: true }).eq("template_id", templateId!),
      ]);
      if (groups.error) throw new Error(errorMessage(groups.error));
      if (rows.error) throw new Error(errorMessage(rows.error));
      return (groups.count ?? 0) + (rows.count ?? 0);
    },
  });
}
