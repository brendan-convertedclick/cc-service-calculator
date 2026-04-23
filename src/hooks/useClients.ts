import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];

export type { Client };

const LIST = ["clients"] as const;
const FOLDERS = ["clickup_folders"] as const;
const SPACES = ["clickup_spaces"] as const;

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

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ClientUpdate }) => {
      const { data, error } = await supabase.from("clients").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useClickUpFolders() {
  return useQuery({
    queryKey: FOLDERS,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await supabase.functions.invoke("list-clickup-folders", {
        body: {},
      });
      if (error) throw error;
      return (data as { folders: Array<{ id: string; name: string }> }).folders;
    },
  });
}

export function useClickUpSpaces() {
  return useQuery({
    queryKey: SPACES,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await supabase.functions.invoke("list-clickup-spaces", {
        body: {},
      });
      if (error) throw error;
      return (data as { spaces: Array<{ id: string; name: string }> }).spaces;
    },
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
