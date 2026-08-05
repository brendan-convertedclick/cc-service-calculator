// src/hooks/useTaskExtensionRequests.ts
//
// Approved staff extension_requests (admin/owner-tier points and due-date
// pushes — see /staff and /escalations) for a given ClickUp task, so the
// brief's own History timeline can show them alongside brief_extensions
// (the separate client-approval flow raised from BriefedTaskPanel itself).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ExtensionRequestRow } from "@/types/extension-requests";

export function useTaskExtensionRequests(clickupTaskId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["task-extension-requests", clickupTaskId],
    enabled: enabled && !!clickupTaskId,
    queryFn: async (): Promise<ExtensionRequestRow[]> => {
      const { data, error } = await supabase
        .from("extension_requests")
        .select("*")
        .eq("parent_clickup_task_id", clickupTaskId!)
        .in("status", ["approved", "auto_approved"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExtensionRequestRow[];
    },
  });
}
