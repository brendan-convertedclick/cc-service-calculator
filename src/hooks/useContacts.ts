// src/hooks/useContacts.ts
//
// The people at a client we are allowed to talk to.
//
// `contacts` was read-only in this app until now: five places queried it and
// nothing wrote it, so the only rows that ever existed were the conservative
// handful the 0139 backfill could vouch for — 9 across 3 clients out of 37.
// Every downstream feature that needs a named human (personal sign-off links,
// questions, messages, the "And you are?" picker) was therefore dead for
// almost every client, with no way in the UI to fix it. This is that way in.
//
// Email is the identity and is immutable after creation: it is half the unique
// key, personal review tokens hang off the contact id, and silently editing an
// address would re-point a live link at a different person. Wrong address =
// delete and re-add, which revokes nothing by accident because the token FK
// cascades.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

export type ClientContact = {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  is_primary: boolean;
};

const KEY = (clientId: string) => ["client-contacts", clientId] as const;

export function useClientContacts(clientId: string | undefined) {
  return useQuery({
    queryKey: KEY(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async (): Promise<ClientContact[]> => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, full_name, email, role, is_primary")
        .eq("client_id", clientId!)
        .order("is_primary", { ascending: false })
        .order("full_name");
      if (error) throw new Error(errorMessage(error));
      return (data ?? []) as ClientContact[];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, clientId: string) {
  void qc.invalidateQueries({ queryKey: KEY(clientId) });
}

export function useAddContact(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fullName: string; email: string; role: string }) => {
      if (!clientId) throw new Error("No client selected");
      const email = input.email.trim().toLowerCase();
      const fullName = input.fullName.trim();
      if (!fullName) throw new Error("A contact needs a name — it is what a client sees when they sign something off.");
      // Not a validator, a typo catch. The address is checked properly by the
      // only thing that can check it: sending to it.
      if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) throw new Error("That does not look like an email address.");

      const { error } = await supabase
        .from("contacts")
        .insert({ client_id: clientId, email, full_name: fullName, role: input.role.trim() || null });
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "That address is already on this client."
            : errorMessage(error),
        );
      }
    },
    onSuccess: () => clientId && invalidate(qc, clientId),
  });
}

export function useUpdateContact(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; fullName: string; role: string }) => {
      const fullName = input.fullName.trim();
      if (!fullName) throw new Error("A contact needs a name.");
      const { error } = await supabase
        .from("contacts")
        .update({ full_name: fullName, role: input.role.trim() || null })
        .eq("id", input.id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => clientId && invalidate(qc, clientId),
  });
}

/**
 * Exactly one primary per client. Done as clear-then-set rather than a partial
 * unique index, because the index would reject the intermediate state of any
 * two-statement swap and there is no transaction from the browser.
 */
export function useSetPrimaryContact(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      if (!clientId) throw new Error("No client selected");
      const { error: clearErr } = await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("client_id", clientId);
      if (clearErr) throw new Error(errorMessage(clearErr));
      const { error } = await supabase
        .from("contacts")
        .update({ is_primary: true })
        .eq("id", contactId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => clientId && invalidate(qc, clientId),
  });
}

/**
 * Removing a contact cascades to their personal review tokens, which is the
 * point: someone who has left should not keep a live link that signs as them.
 * Their name survives on anything they already decided — decided_by_name is a
 * snapshot (0142), not a join.
 */
export function useDeleteContact(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", contactId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => clientId && invalidate(qc, clientId),
  });
}
