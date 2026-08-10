import { useEffect } from "react";
import { toast } from "sonner";
import { useClients, type Client } from "@/hooks/useClients";

/**
 * Clients for the "Client" picker in the staff self-service forms (brief,
 * revision, extension). Thin wrapper over the shared `useClients()` query —
 * these forms used to run their own `clients` fetch; this keeps the
 * toast-on-failure behaviour that fetch had.
 */
export function useStaffClients(): Client[] {
  const { data: clients = [], error } = useClients();
  useEffect(() => {
    if (error) toast.error(`Could not load clients: ${error.message}`);
  }, [error]);
  return clients;
}
