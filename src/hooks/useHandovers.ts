// src/hooks/useHandovers.ts
//
// Hand-overs waiting for someone to press Send (0204).
//
// handover-signoffs drafts a PARKED client_approvals row when a doer moves a
// briefed task to "send to client" with a closing comment and proof. Parked
// keeps it off the client's page and off every clock. This is the queue of
// those rows, and the one act that releases one: Send, which
//   1. sets the title the client will read (editable — the drafted one comes
//      from the ClickUp task name),
//   2. moves it parked → pending, with a status row on its timeline, and
//   3. emails each chosen contact their own personal link (0142), as the
//      signed-in person, through the same sendOnPersonalLink every other
//      client email uses.
// The row is moved before the email for the reason useAskClientQuestion gives:
// an email pointing at an item the page does not show is worse than an item
// the page shows that nobody was told about, which the table surfaces as
// "not sent".

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/utils";
import { buildWorkDoneEmail } from "@/lib/client-email";
import { fetchStageCounts } from "@/lib/client-stage-counts";
import { LINK_DAYS, sendOnPersonalLink, type OutboundContact } from "@/lib/client-outbound";

export type HandoverProof = { name: string; path: string; mime: string; size: number };

export type Handover = {
  id: string;
  client_id: string;
  client_name: string;
  brief_id: string;
  client_title: string;
  detail: string;
  links: string[];
  proof: HandoverProof[];
  handed_over_at: string;
  handed_over_by: string | null;
  clickup_task_id: string | null;
};

const KEY = ["handovers"] as const;

export function useHandovers() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Handover[]> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .select(
          "id, client_id, brief_id, client_title, detail, links, proof, handed_over_at, handed_over_by, clients(name), briefs(clickup_task_id)",
        )
        .eq("state", "parked")
        .not("handed_over_at", "is", null)
        .order("handed_over_at");
      if (error) throw new Error(errorMessage(error));
      return (data ?? []).map((r) => {
        const row = r as unknown as Omit<Handover, "client_name" | "clickup_task_id"> & {
          clients: { name: string } | { name: string }[] | null;
          briefs: { clickup_task_id: string | null } | { clickup_task_id: string | null }[] | null;
        };
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const brief = Array.isArray(row.briefs) ? row.briefs[0] : row.briefs;
        return {
          id: row.id,
          client_id: row.client_id,
          client_name: client?.name ?? "",
          brief_id: row.brief_id,
          client_title: row.client_title,
          detail: row.detail ?? "",
          links: row.links ?? [],
          proof: row.proof ?? [],
          handed_over_at: row.handed_over_at,
          handed_over_by: row.handed_over_by,
          clickup_task_id: brief?.clickup_task_id ?? null,
        };
      });
    },
  });
}

/** Short-lived URLs for the staff preview of a hand-over's proof. */
export function useHandoverProofUrls(proof: HandoverProof[]) {
  const paths = proof.map((p) => p.path);
  return useQuery({
    queryKey: ["handover-proof", ...paths],
    enabled: paths.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.storage.from("signoff-proof").createSignedUrls(paths, 3600);
      if (error) throw new Error(errorMessage(error));
      const out = new Map<string, string>();
      for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
      return out;
    },
  });
}

export type SendHandoverInput = {
  handover: Handover;
  title: string;
  recipients: OutboundContact[];
};

export function useSendHandover() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: SendHandoverInput): Promise<{ failures: string[] }> => {
      if (!currentUserId) {
        throw new Error(
          "Sign in with your own account to send this. The shared team@ login has no sender to attribute it to.",
        );
      }
      const title = input.title.trim();
      if (!title) throw new Error("Give it a title the client will recognise.");
      if (input.recipients.length === 0) throw new Error("Pick at least one person to send it to.");
      const h = input.handover;

      // 1 + 2: the row the link opens, released before anyone is invited to it.
      // Guarded on state so a double-click cannot release it twice.
      const { data: moved, error: moveErr } = await supabase
        .from("client_approvals")
        .update({ client_title: title, state: "pending" })
        .eq("id", h.id)
        .eq("state", "parked")
        .select("id");
      if (moveErr) throw new Error(errorMessage(moveErr));
      if (!moved?.length) throw new Error("Someone already sent this one.");
      await supabase.from("client_activity").insert({
        client_id: h.client_id,
        approval_id: h.id,
        kind: "status",
        from_state: "parked",
        to_state: "pending",
        created_by: currentUserId,
      });

      // 3: one personal link and one email per person (0142).
      const counts = await fetchStageCounts(h.client_id);
      const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
      const failures: string[] = [];
      let first = true;
      for (const person of input.recipients) {
        const { outboundId, sendError } = await sendOnPersonalLink({
          clientId: h.client_id,
          briefId: h.brief_id,
          contact: person,
          label: `${person.name ?? person.email} — ${title}`,
          expiresAt,
          createdBy: currentUserId,
          template: "client_work_done",
          build: (url) =>
            buildWorkDoneEmail({ title, whatWeDid: h.detail, url, contactName: person.name, counts }),
        });
        if (first) {
          first = false;
          await supabase.from("client_approvals").update({ outbound_email_id: outboundId }).eq("id", h.id);
        }
        if (sendError) failures.push(sendError);
      }
      if (failures.length === input.recipients.length) throw new Error(failures.join("; "));
      return { failures };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
      void qc.invalidateQueries({ queryKey: ["client-review-preview"] });
      void qc.invalidateQueries({ queryKey: ["client-review-link-counts"] });
    },
  });
}
