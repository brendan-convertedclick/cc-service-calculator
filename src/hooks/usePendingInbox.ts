import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PendingClient = {
  id: string;
  domain: string;
  sample_sender: string | null;
  sample_subject: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
};

export type PendingSenderWithClient = {
  id: string;
  client_id: string;
  client_name: string;
  email: string;
  sample_subject: string | null;
  last_seen_at: string;
  seen_count: number;
};

export function usePendingInbox() {
  const clientsQ = useQuery({
    queryKey: ["pending-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_clients")
        .select("id, domain, sample_sender, sample_subject, first_seen_at, last_seen_at, seen_count")
        .is("dismissed_at", null)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingClient[];
    },
  });

  const sendersQ = useQuery({
    queryKey: ["pending-senders", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_senders")
        .select("id, client_id, email, sample_subject, last_seen_at, seen_count, client:clients!inner(name)")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        client_id: r.client_id,
        client_name: (r.client as { name: string }).name,
        email: r.email,
        sample_subject: r.sample_subject,
        last_seen_at: r.last_seen_at,
        seen_count: r.seen_count,
      })) as PendingSenderWithClient[];
    },
  });

  const pendingClients = clientsQ.data ?? [];
  const pendingSenders = sendersQ.data ?? [];

  return {
    pendingClients,
    pendingSenders,
    total: pendingClients.length + pendingSenders.length,
    isLoading: clientsQ.isLoading || sendersQ.isLoading,
  };
}

export function useApprovePendingClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pending: PendingClient;
      name: string;
      primary_domain: string;
      clickup_folder_id?: string | null;
    }) => {
      const name = input.name.trim();
      const { error: insErr } = await supabase
        .from("clients")
        .insert({
          name,
          // short_name is NOT NULL + unique (see migration 0048); defaults to
          // `name`, same convention as that migration's backfill. Editable
          // afterwards from client settings.
          short_name: name,
          primary_domain: input.primary_domain.trim().toLowerCase(),
          clickup_folder_id: input.clickup_folder_id ?? null,
        });
      if (insErr) throw insErr;
      const { error: delErr } = await supabase
        .from("pending_clients")
        .delete()
        .eq("id", input.pending.id);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-clients"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["pending-senders", "all"] });
    },
  });
}

export function useDismissPendingClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pending_clients")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-clients"] }),
  });
}

export function useDismissPendingSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pending_senders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-senders", "all"] });
      qc.invalidateQueries({ queryKey: ["pending-senders"] });
    },
  });
}
