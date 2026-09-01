// src/hooks/useClientReviewLinks.ts
//
// Minting and revoking the client-facing review link.
//
// The plaintext token exists for exactly one moment: here, in the browser, in
// the return value of the mint mutation. Only its sha256 is written to
// client_review_tokens, so nobody — not us, not a database dump — can
// reconstruct a working link afterwards. If staff lose the URL they mint a new
// one and revoke the old.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

export type ClientReviewLink = {
  id: string;
  label: string | null;
  contact_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

const KEY = (clientId: string) => ["client-review-links", clientId] as const;

/**
 * 32 bytes of CSPRNG as base64url. Mirrors newPlaintextToken() in
 * supabase/functions/_shared/hmac.ts — the edge function hashes what arrives
 * in the URL, so both sides must agree on the alphabet, not the generator.
 */
export function newPlaintextToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hex sha256, identical to what the edge function computes on lookup. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The full URL a client opens. Absolute, because it is pasted into an email. */
export function reviewUrlFor(token: string): string {
  return `${window.location.origin}/review/${token}`;
}

export function useClientReviewLinks(clientId: string | undefined) {
  return useQuery({
    queryKey: KEY(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async (): Promise<ClientReviewLink[]> => {
      const { data, error } = await supabase
        .from("client_review_tokens")
        .select("id, label, contact_id, expires_at, revoked_at, last_used_at, created_at")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(errorMessage(error));
      return data ?? [];
    },
  });
}

/**
 * Mint a link. Returns the plaintext URL — show it to the person now, because
 * it cannot be recovered. Rows are never updated in place: revoking and
 * minting again is the rotation story.
 *
 * PASS A contactId WHENEVER YOU CAN (0142). A link scoped to one person IS
 * that person's identity: the review page greets them by name, never asks
 * "And you are?", and the server records the signer from the token rather than
 * from anything the browser claims. A link with no contact is company-wide —
 * anyone holding it can sign as any of that client's contacts — and exists
 * only for the case where you genuinely do not know who will open it.
 */
export function useMintClientReviewLink(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      label?: string;
      expiresAt?: string | null;
      contactId?: string | null;
    }) => {
      if (!clientId) throw new Error("No client selected");
      const token = newPlaintextToken();
      const { error } = await supabase.from("client_review_tokens").insert({
        client_id: clientId,
        token_hash: await sha256Hex(token),
        label: input.label?.trim() || null,
        expires_at: input.expiresAt ?? null,
        contact_id: input.contactId ?? null,
      });
      if (error) throw new Error(errorMessage(error));
      return { token, url: reviewUrlFor(token) };
    },
    onSuccess: () => {
      if (clientId) void qc.invalidateQueries({ queryKey: KEY(clientId) });
    },
  });
}

export function useRevokeClientReviewLink(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("client_review_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      if (clientId) void qc.invalidateQueries({ queryKey: KEY(clientId) });
    },
  });
}
