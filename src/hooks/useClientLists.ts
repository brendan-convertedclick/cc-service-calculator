import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ClientList } from "@/types/ongoing";

export function useClientLists(clientId: string | null) {
  return useQuery<ClientList[]>({
    queryKey: ["client-lists", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_lists")
        .select("*")
        .eq("client_id", clientId!)
        .is("archived_at", null)
        .order("clickup_list_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSyncClientStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "sync-client-clickup-structure",
        { body: { client_id: clientId } },
      );
      if (error) throw error;
      const body = data as {
        error?: string;
        discovered?: number;
        refreshed?: number;
      };
      if (body.error) throw new Error(body.error);
      return body as { discovered: number; refreshed: number };
    },
    onSuccess: (_d, clientId) => {
      qc.invalidateQueries({ queryKey: ["client-lists", clientId] });
    },
  });
}

// Assigns a task_group to a client_list row, or clears it (group_id null).
// Used by the mapping UI. Custom-labelled rows aren't editable through this
// hook — they're created via create-client-list (Step 4).
export function useUpdateClientList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { id: string; group_id: string | null; client_id: string }) => {
      const { error } = await supabase
        .from("client_lists")
        .update({ group_id: patch.group_id })
        .eq("id", patch.id);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ["client-lists", patch.client_id] });
    },
  });
}

export function useCreateClientList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      client_id: string;
      group_id?: string | null;
      custom_label?: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-client-list",
        { body: input },
      );
      if (error) throw error;
      const body = data as {
        error?: string;
        client_list_id?: string;
        clickup_list_id?: string;
        clickup_list_name?: string;
      };
      if (body.error) throw new Error(body.error);
      return body as {
        client_list_id: string;
        clickup_list_id: string;
        clickup_list_name: string;
      };
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["client-lists", input.client_id] });
    },
  });
}

export function useArchiveClientList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { id: string; client_id: string }) => {
      const { error } = await supabase
        .from("client_lists")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", patch.id);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.invalidateQueries({ queryKey: ["client-lists", patch.client_id] });
    },
  });
}
