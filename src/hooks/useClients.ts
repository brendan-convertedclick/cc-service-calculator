import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

export type { Client };

const LIST = ["clients"] as const;
const FOLDERS = ["clickup_folders"] as const;
const SPACES = ["clickup_spaces"] as const;
const CHAT_CHANNELS = ["clickup_chat_channels"] as const;

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
      // Fire-and-forget wiki provisioning (do not await)
      ;(async () => {
        try {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token ?? "";
          const wikiPath = `wiki/clients/${data.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
          await fetch(`${supabaseUrl}/functions/v1/provision-client-wiki`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ client_name: data.name, wiki_path: wikiPath }),
          });
        } catch (err) {
          console.warn("[provision-client-wiki] fire-and-forget failed:", err);
        }
      })();
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

export function useClickUpChatChannels() {
  return useQuery({
    queryKey: CHAT_CHANNELS,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await supabase.functions.invoke("list-chat-channels", {
        body: {},
      });
      if (error) throw error;
      return (data as { channels: Array<{ id: string; name: string }> }).channels;
    },
  });
}
