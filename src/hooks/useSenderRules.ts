import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { evaluatePattern } from "@/lib/senderRules";

export type SenderRule = {
  id: string;
  client_id: string;
  pattern: string;
  mode: "allow" | "block";
  note: string | null;
};

export type PendingSender = {
  id: string;
  client_id: string;
  email: string;
  sample_subject: string | null;
  sample_brief_id: string | null;
  last_seen_at: string;
  seen_count: number;
};

export type BriefMatch = {
  id: string;
  raw_subject: string | null;
  sender_email: string | null;
  received_at: string;
  status: string;
};

export function useSenderRules(clientId: string) {
  return useQuery({
    queryKey: ["sender-rules", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_sender_rules")
        .select("id, client_id, pattern, mode, note")
        .eq("client_id", clientId)
        .order("mode");
      if (error) throw error;
      return data as SenderRule[];
    },
    enabled: !!clientId,
  });
}

export function usePendingSenders(clientId: string) {
  return useQuery({
    queryKey: ["pending-senders", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_senders")
        .select(
          "id, client_id, email, sample_subject, sample_brief_id, last_seen_at, seen_count",
        )
        .eq("client_id", clientId)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data as PendingSender[];
    },
    enabled: !!clientId,
  });
}

export function useUpsertSenderRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: {
      client_id: string;
      pattern: string;
      mode: "allow" | "block";
      note?: string | null;
    }) => {
      const pattern = rule.pattern.trim().toLowerCase();
      if (!pattern.includes("@")) {
        throw new Error("Pattern must be an email or *@domain");
      }
      const { data, error } = await supabase
        .from("client_sender_rules")
        .upsert(
          {
            client_id: rule.client_id,
            pattern,
            mode: rule.mode,
            note: rule.note ?? null,
          },
          { onConflict: "client_id,pattern" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as SenderRule;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["sender-rules", v.client_id] }),
  });
}

export function useDeleteSenderRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, client_id }: { id: string; client_id: string }) => {
      const { error } = await supabase
        .from("client_sender_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return { client_id };
    },
    onSuccess: (r) =>
      qc.invalidateQueries({ queryKey: ["sender-rules", r.client_id] }),
  });
}

export function useBlacklistSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      briefId,
      clientId,
      senderEmail,
    }: {
      briefId: string;
      clientId: string;
      senderEmail: string;
    }) => {
      const pattern = senderEmail.trim().toLowerCase();
      const { error: ruleErr } = await supabase
        .from("client_sender_rules")
        .upsert(
          { client_id: clientId, pattern, mode: "block" },
          { onConflict: "client_id,pattern" },
        );
      if (ruleErr) throw ruleErr;
      const { error: pendErr } = await supabase
        .from("pending_senders")
        .delete()
        .eq("client_id", clientId)
        .eq("email", pattern);
      if (pendErr) throw pendErr;
      const { error: briefErr } = await supabase
        .from("briefs")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", briefId);
      if (briefErr) throw briefErr;
      return { clientId, pattern };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["briefs-matching"] });
      qc.invalidateQueries({ queryKey: ["sender-rules", r.clientId] });
      qc.invalidateQueries({ queryKey: ["pending-senders", r.clientId] });
    },
  });
}

export function useResolvePendingSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pending,
      action,
    }: {
      pending: PendingSender;
      action: "allow" | "block";
    }) => {
      const { error: insErr } = await supabase
        .from("client_sender_rules")
        .upsert(
          {
            client_id: pending.client_id,
            pattern: pending.email.toLowerCase(),
            mode: action,
          },
          { onConflict: "client_id,pattern" },
        );
      if (insErr) throw insErr;
      const { error: delErr } = await supabase
        .from("pending_senders")
        .delete()
        .eq("id", pending.id);
      if (delErr) throw delErr;
      return pending;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["sender-rules", p.client_id] });
      qc.invalidateQueries({ queryKey: ["pending-senders", p.client_id] });
    },
  });
}

export function useBriefsMatchingSender(
  clientId: string,
  pattern: string,
  enabled: boolean,
) {
  return useQuery({
    enabled: enabled && !!pattern && !!clientId,
    queryKey: ["briefs-matching", clientId, pattern],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("id, raw_subject, sender_email, received_at, status")
        .eq("client_id", clientId)
        .not("status", "in", '("archived","rejected","spam")');
      if (error) throw error;
      return (data ?? []).filter((b) =>
        b.sender_email ? evaluatePattern(pattern, b.sender_email) : false,
      ) as BriefMatch[];
    },
  });
}

export function useApplyRetroAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      brief_ids,
      action,
    }: {
      brief_ids: string[];
      action: "archive" | "delete";
    }) => {
      if (action === "archive") {
        const { error } = await supabase
          .from("briefs")
          .update({ status: "archived" })
          .in("id", brief_ids);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("briefs")
          .delete()
          .in("id", brief_ids);
        if (error) throw error;
      }
      return brief_ids.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefs"] });
      qc.invalidateQueries({ queryKey: ["briefs-matching"] });
    },
  });
}
