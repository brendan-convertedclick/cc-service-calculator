import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type FilterContact = { email: string; count: number };
export type FilterClient = {
  id: string;
  name: string;
  count: number;
  contacts: FilterContact[];
};
export type FilterTree = {
  clients: FilterClient[];
  unassigned: { count: number };
};

export function useInboxFilterTree() {
  return useQuery({
    queryKey: ["inbox-filter-tree"],
    queryFn: async (): Promise<FilterTree> => {
      const [briefsResult, clientsResult] = await Promise.all([
        supabase
          .from("briefs")
          .select("client_id, sender_email")
          .is("parent_project_id", null),
        supabase
          .from("clients")
          .select("id, name")
          .is("archived_at", null)
          .order("name"),
      ]);

      if (briefsResult.error) throw briefsResult.error;
      if (clientsResult.error) throw clientsResult.error;

      const briefs = briefsResult.data ?? [];
      const clientRows = clientsResult.data ?? [];

      // Build a lookup: clientId → { totalCount, contacts: Map<email, count> }
      const clientMap = new Map<
        string,
        { count: number; contacts: Map<string, number> }
      >();
      let unassignedCount = 0;

      for (const b of briefs) {
        if (b.client_id === null) {
          unassignedCount++;
          continue;
        }
        if (!clientMap.has(b.client_id)) {
          clientMap.set(b.client_id, { count: 0, contacts: new Map() });
        }
        const entry = clientMap.get(b.client_id)!;
        entry.count++;
        if (b.sender_email) {
          entry.contacts.set(
            b.sender_email,
            (entry.contacts.get(b.sender_email) ?? 0) + 1,
          );
        }
      }

      const clients: FilterClient[] = clientRows
        .filter((c) => clientMap.has(c.id))
        .map((c) => {
          const entry = clientMap.get(c.id)!;
          const contacts: FilterContact[] = Array.from(
            entry.contacts.entries(),
          )
            .map(([email, count]) => ({ email, count }))
            .sort((a, b) => b.count - a.count);
          return { id: c.id, name: c.name, count: entry.count, contacts };
        });

      return { clients, unassigned: { count: unassignedCount } };
    },
    staleTime: 30_000,
  });
}
