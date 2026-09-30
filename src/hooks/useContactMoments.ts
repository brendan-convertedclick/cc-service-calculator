// src/hooks/useContactMoments.ts
//
// Reads and writes for /moments (0193). The calendar reads every moment at
// once — a few hundred rows across the agency at most — and expands repeats
// client-side in src/lib/contact-moments.ts, so switching week/month/year or
// school never goes back to the network.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { addDays, type AskStage, type Moment, type MomentAsk, type MomentKind } from "@/lib/contact-moments";
import { todayISO } from "@/lib/dates";

const MOMENTS = ["contact-moments"] as const;
const ASKS = ["contact-moment-asks"] as const;

type MomentRow = {
  id: string;
  contact_id: string;
  client_id: string;
  kind: string;
  title: string | null;
  on_date: string;
  repeats_yearly: boolean;
  ask_about: string | null;
  notes: string | null;
  created_by: string | null;
  contact: { full_name: string | null; email: string; role: string | null } | null;
  client: { name: string } | null;
};

export function useContactMoments() {
  return useQuery({
    queryKey: MOMENTS,
    queryFn: async (): Promise<Moment[]> => {
      const { data, error } = await supabase
        .from("contact_moments")
        .select(
          "id, contact_id, client_id, kind, title, on_date, repeats_yearly, ask_about, notes, created_by, " +
            "contact:contacts!contact_moments_contact_fk(full_name, email, role), " +
            "client:clients!contact_moments_client_id_fkey(name)",
        );
      if (error) throw new Error(errorMessage(error));
      return ((data ?? []) as unknown as MomentRow[]).map((r) => ({
        id: r.id,
        contact_id: r.contact_id,
        client_id: r.client_id,
        kind: r.kind as MomentKind,
        title: r.title,
        on_date: r.on_date,
        repeats_yearly: r.repeats_yearly,
        ask_about: r.ask_about,
        notes: r.notes,
        created_by: r.created_by,
        contactName: r.contact?.full_name || r.contact?.email || "Someone",
        contactRole: r.contact?.role ?? null,
        clientName: r.client?.name ?? "",
      }));
    },
  });
}

/** Who asked about what. Older than a year is history nobody is shown. */
export function useMomentAsks() {
  return useQuery({
    queryKey: ASKS,
    queryFn: async (): Promise<MomentAsk[]> => {
      const { data, error } = await supabase
        .from("contact_moment_asks")
        .select("moment_id, occurs_on, stage, asked_by, asked_at")
        .gte("occurs_on", addDays(todayISO(), -400));
      if (error) throw new Error(errorMessage(error));
      return (data ?? []) as MomentAsk[];
    },
  });
}

/** The schools this person is account owner for, from their school years (0150). */
export function useMySchoolIds(teamMemberId: string | null) {
  return useQuery({
    queryKey: ["my-school-ids", teamMemberId],
    enabled: !!teamMemberId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("school_years")
        .select("client_id")
        .eq("account_owner_id", teamMemberId!);
      if (error) throw new Error(errorMessage(error));
      return new Set((data ?? []).map((r) => r.client_id));
    },
  });
}

export type MomentInput = {
  id?: string;
  clientId: string;
  contactId: string;
  kind: MomentKind;
  title: string;
  onDate: string;
  repeatsYearly: boolean;
  askAbout: string;
  notes: string;
};

export function useSaveMoment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, createdBy }: { input: MomentInput; createdBy: string | null }) => {
      const title = input.kind === "birthday" ? null : input.title.trim();
      if (input.kind !== "birthday" && !title) throw new Error("Give it a name, e.g. “Matric dance”.");
      if (!input.onDate) throw new Error("Pick a date.");
      const row = {
        client_id: input.clientId,
        contact_id: input.contactId,
        kind: input.kind,
        title,
        on_date: input.onDate,
        repeats_yearly: input.repeatsYearly,
        ask_about: input.askAbout.trim() || null,
        notes: input.notes.trim() || null,
      };
      const { error } = input.id
        ? await supabase.from("contact_moments").update(row).eq("id", input.id)
        : await supabase.from("contact_moments").insert({ ...row, created_by: createdBy });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MOMENTS }),
  });
}

export function useDeleteMoment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_moments").delete().eq("id", id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MOMENTS });
      void qc.invalidateQueries({ queryKey: ASKS });
    },
  });
}

export function useSetMomentAsked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { momentId: string; date: string; stage: AskStage; asked: boolean; by: string | null }) => {
      const { error } = v.asked
        ? await supabase
            .from("contact_moment_asks")
            .upsert({ moment_id: v.momentId, occurs_on: v.date, stage: v.stage, asked_by: v.by })
        : await supabase
            .from("contact_moment_asks")
            .delete()
            .eq("moment_id", v.momentId)
            .eq("occurs_on", v.date)
            .eq("stage", v.stage);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ASKS }),
  });
}
