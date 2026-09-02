// Which procedure a service is delivered by.
//
// The link lives on services.procedure_id (0140). One procedure serves many
// services — the same "Carousel Paid Social Posts (Photoshop)" procedure is how
// we do that work for Facebook, Instagram AND LinkedIn — so the picker offers
// every approved procedure, whether or not it is already attached elsewhere.
//
// system_definitions.service_id is a different thing and still exists: it is
// the procedure's HOME service, what system_def_kind_link (0113) requires for
// kind='service', and what the systems library shows as the service badge.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { SERVICES_LIST_KEY } from "@/hooks/useServices";

export interface ProcedureOption {
  id: string;
  name: string;
  /** The procedure's home service, if it has one. Not the list it serves. */
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
        // Only the two kinds a service can be delivered by. A policy, a
        // business-process map or an internal (time-category) procedure is not
        // a way of doing a sold service — and offering one would let the claim
        // below flip its kind to 'service' and corrupt it.
        .in("kind", ["service", "reference"])
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
      const { data: prev, error: prevErr } = await supabase
        .from("services")
        .select("procedure_id")
        .eq("id", serviceId)
        .single();
      if (prevErr) throw prevErr;

      const { error } = await supabase
        .from("services")
        .update({ procedure_id: procedureId })
        .eq("id", serviceId);
      if (error) throw error;

      // The home link follows the first service to claim it, and is released
      // when that service lets go. kind and service_id move together, always in
      // one statement — system_def_kind_link says a kind='service' procedure
      // MUST have a service_id, so writing one without the other leaves the row
      // illegal. Other services naming this procedure are untouched: they never
      // held the home link.
      if (prev?.procedure_id && prev.procedure_id !== procedureId) {
        const { error: freeErr } = await supabase
          .from("system_definitions")
          .update({ service_id: null, kind: "reference" })
          .eq("id", prev.procedure_id)
          .eq("service_id", serviceId);
        if (freeErr) throw freeErr;
      }
      if (procedureId) {
        const { error: claimErr } = await supabase
          .from("system_definitions")
          .update({ service_id: serviceId, kind: "service" })
          .eq("id", procedureId)
          .is("service_id", null);
        if (claimErr) throw claimErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SERVICE_PROCEDURES_KEY });
      // Prefix match: SERVICES_LIST_KEY is ["services"], so the detail query
      // ["services", id] is invalidated with it.
      qc.invalidateQueries({ queryKey: SERVICES_LIST_KEY });
      qc.invalidateQueries({ queryKey: ["system_definitions"] });
    },
  });
}
