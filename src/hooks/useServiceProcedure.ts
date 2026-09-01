// Which procedure a service is delivered by.
//
// The link already exists in the schema, but only from one side:
// system_definitions.service_id, set when a procedure is written against a
// service. There was no way to come at it from the service — so the Services
// page could not say whether a service had a documented way of being done.
//
// system_definitions_one_per_service_idx (0107) makes this one-to-one: a
// service has at most one procedure, and a procedure backs at most one service.
// The picker therefore only ever offers procedures that are free.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ProcedureOption {
  id: string;
  name: string;
  serviceId: string | null;
  /** Has a published revision — there is signed-off content to follow. */
  approved: boolean;
}

export const SERVICE_PROCEDURES_KEY = ["service_procedures"] as const;

export function useServiceProcedures() {
  return useQuery({
    queryKey: SERVICE_PROCEDURES_KEY,
    queryFn: async (): Promise<ProcedureOption[]> => {
      const { data, error } = await supabase
        .from("system_definitions")
        .select("id, name, service_id, current_revision_id")
        .is("archived_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        serviceId: s.service_id,
        approved: s.current_revision_id != null,
      }));
    },
  });
}

/** Attach a procedure to a service, or detach whatever is attached. */
export function useSetServiceProcedure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, procedureId }: { serviceId: string; procedureId: string | null }) => {
      // kind and service_id move together, always in the same statement.
      // system_def_kind_link says a kind='service' procedure MUST have a
      // service_id — so clearing the link alone leaves the row illegal, and
      // attaching one to a 'reference' procedure leaves it lying about what it
      // is. Writing one without the other is what threw
      // "violates check constraint system_def_kind_link".
      const { error: clearErr } = await supabase
        .from("system_definitions")
        .update({ service_id: null, kind: "reference" })
        .eq("service_id", serviceId);
      if (clearErr) throw clearErr;
      if (!procedureId) return;
      const { error } = await supabase
        .from("system_definitions")
        .update({ service_id: serviceId, kind: "service" })
        .eq("id", procedureId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SERVICE_PROCEDURES_KEY });
      qc.invalidateQueries({ queryKey: ["system_definitions"] });
    },
  });
}
