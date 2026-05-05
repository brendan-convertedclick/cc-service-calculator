import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type RelayTokenStatus = {
  user_email: string;
  exists: boolean;
  created_at: string | null;
  revoked_at: string | null;
};

const KEY = ["relay-tokens"] as const;

export function useRelayTokenStatus(userEmail: string | null | undefined) {
  return useQuery({
    enabled: !!userEmail,
    queryKey: [...KEY, userEmail],
    queryFn: async (): Promise<RelayTokenStatus | null> => {
      if (!userEmail) return null;
      const { data, error } = await supabase
        .from("relay_secrets")
        .select("user_email, created_at, revoked_at")
        .eq("user_email", userEmail)
        .maybeSingle();
      if (error) throw error;
      return {
        user_email: userEmail,
        exists: !!data && !data.revoked_at,
        created_at: data?.created_at ?? null,
        revoked_at: data?.revoked_at ?? null,
      };
    },
  });
}

export function useIssueRelayToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ token: string; user_email: string }> => {
      const { data, error } = await supabase.functions.invoke("issue-relay-token", { body: {} });
      if (error) throw error;
      return data as { token: string; user_email: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeRelayToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userEmail: string) => {
      const { error } = await supabase
        .from("relay_secrets")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_email", userEmail);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
