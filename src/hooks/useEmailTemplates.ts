// Email templates (0056) — the standard client emails, and the thing a step
// can point at so whoever runs it isn't rewriting the same message.
//
// 0128 opened read to every authenticated user (a staff member has to see the
// template a step links to) and kept writing to admin/owner: a template is an
// agency standard, like the rate card.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/db";

export type EmailTemplate = Database["public"]["Tables"]["email_templates"]["Row"];
type TemplateInsert = Database["public"]["Tables"]["email_templates"]["Insert"];
type TemplateUpdate = Database["public"]["Tables"]["email_templates"]["Update"];

export const EMAIL_TEMPLATES_KEY = ["email_templates"] as const;

/** Every variable a template body/subject refers to, as {name} placeholders. */
export function variablesIn(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const m of (part ?? "").matchAll(/\{([a-z0-9_]+)\}/gi)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Fill {placeholders} from a values map; anything unknown is left as-is so a
 *  missing value is visible in the draft rather than silently blank. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-z0-9_]+)\}/gi, (whole, name) => values[name] ?? whole);
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: EMAIL_TEMPLATES_KEY,
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; patch: TemplateInsert | TemplateUpdate }) => {
      if (input.id) {
        const { data, error } = await supabase
          .from("email_templates")
          .update(input.patch as TemplateUpdate)
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("email_templates")
        .insert(input.patch as TemplateInsert)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: EMAIL_TEMPLATES_KEY }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // process_steps.email_template_id is ON DELETE SET NULL, so a step that
      // used this keeps existing — it just loses the shortcut.
      const { error } = await supabase.from("email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EMAIL_TEMPLATES_KEY });
      qc.invalidateQueries({ queryKey: ["process_steps"] });
    },
  });
}
