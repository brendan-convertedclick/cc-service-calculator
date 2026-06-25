// src/hooks/useSowComposer.ts
//
// Data layer for the Scope Composer (/sow/docs/:id, /sow/templates/:id).
// The sow_* tables (migration 0072) aren't in the generated Database types yet,
// so we query untyped and cast — the same pattern useScopeMap uses for
// brief_task_sow_placements / client_sows.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type {
  OverrideMap,
  SowBody,
  SowDocument,
  SowLibraryItem,
  SowTemplate,
  VariableDef,
} from "@/types/sow-composer";

const sb = supabase as unknown as SupabaseClient;

export const SOW_DOC_KEY = (id: string) => ["sow-document", id] as const;
export const SOW_TEMPLATE_KEY = (id: string) => ["sow-template", id] as const;
export const SOW_VARIABLES_KEY = (templateId: string | null) =>
  ["sow-variables", templateId ?? "global"] as const;
export const SOW_LIBRARY_KEY = ["sow-library"] as const;
export const CLIENT_VARS_KEY = (clientId: string) => ["client-variable-overrides", clientId] as const;

// ── Documents ─────────────────────────────────────────────────────────────────

export function useSowDocument(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: SOW_DOC_KEY(id ?? "none"),
    queryFn: async (): Promise<SowDocument | null> => {
      if (!id) return null;
      const { data, error } = await sb
        .from("sow_documents")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as SowDocument | null) ?? null;
    },
  });
}

export interface UpsertSowDocumentInput {
  id: string;
  body?: SowBody;
  variable_overrides?: OverrideMap;
  title?: string;
  status?: SowDocument["status"];
}

/** Patch a document. Components debounce calls for autosave. */
export function useUpsertSowDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpsertSowDocumentInput) => {
      const { data, error } = await sb
        .from("sow_documents")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as SowDocument;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: SOW_DOC_KEY(d.id) });
    },
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function useSowTemplate(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: SOW_TEMPLATE_KEY(id ?? "none"),
    queryFn: async (): Promise<SowTemplate | null> => {
      if (!id) return null;
      const { data, error } = await sb
        .from("sow_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as SowTemplate | null) ?? null;
    },
  });
}

// ── Variable registry ─────────────────────────────────────────────────────────

/** Global variables plus any scoped to the given template. */
export function useSowVariables(templateId: string | null = null) {
  return useQuery({
    queryKey: SOW_VARIABLES_KEY(templateId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<VariableDef[]> => {
      let q = sb.from("sow_variables").select("*");
      q = templateId
        ? q.or(`template_id.is.null,template_id.eq.${templateId}`)
        : q.is("template_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data as VariableDef[] | null) ?? [];
    },
  });
}

// ── Per-client variable overrides ─────────────────────────────────────────────

export function useClientVariableOverrides(clientId: string | undefined) {
  return useQuery({
    enabled: !!clientId,
    queryKey: CLIENT_VARS_KEY(clientId ?? "none"),
    queryFn: async (): Promise<OverrideMap> => {
      if (!clientId) return {};
      const { data, error } = await sb
        .from("clients")
        .select("variable_overrides")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return ((data as { variable_overrides?: OverrideMap } | null)?.variable_overrides) ?? {};
    },
  });
}

export function useUpdateClientVariableOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, overrides }: { clientId: string; overrides: OverrideMap }) => {
      const { data, error } = await sb
        .from("clients")
        .update({ variable_overrides: overrides })
        .eq("id", clientId)
        .select("id, variable_overrides")
        .single();
      if (error) throw error;
      return data as { id: string; variable_overrides: OverrideMap };
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: CLIENT_VARS_KEY(d.id) }),
  });
}

// ── Content library (section/snippet reuse) ───────────────────────────────────

export function useSowLibrary() {
  return useQuery({
    queryKey: SOW_LIBRARY_KEY,
    queryFn: async (): Promise<SowLibraryItem[]> => {
      const { data, error } = await sb
        .from("sow_library_items")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data as SowLibraryItem[] | null) ?? [];
    },
  });
}

export function useSaveSectionToLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: Pick<SowLibraryItem, "name" | "type" | "node"> & { tags?: string[] }) => {
      const { data, error } = await sb
        .from("sow_library_items")
        .insert({ name: item.name, type: item.type, node: item.node, tags: item.tags ?? [] })
        .select()
        .single();
      if (error) throw error;
      return data as SowLibraryItem;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SOW_LIBRARY_KEY }),
  });
}
