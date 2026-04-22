import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];

const LIST = ["clients"] as const;

export function useClients() {
  return useQuery({
    queryKey: LIST,
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase
        .from("clients").select("*").is("archived_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useContacts(clientId: string | undefined) {
  return useQuery({
    enabled: !!clientId,
    queryKey: ["contacts", clientId],
    queryFn: async (): Promise<Contact[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("contacts").select("*").eq("client_id", clientId).order("is_primary", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContactInsert) => {
      const { data, error } = await supabase.from("contacts").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["contacts", vars.client_id] }),
  });
}
