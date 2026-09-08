// src/hooks/useClientChase.ts
//
// One email that says "here is everything sitting with you", sent to a
// client's contacts on their own personal links.
//
// It is NOT a message against an item. `useSendClientMessage` is that, and it
// needs an item to hang off — `client_activity.approval_id` is NOT NULL and
// rightly so, because a message about the Open Day mailer belongs on the Open
// Day mailer's timeline. A chase belongs to no item, so it writes no activity
// row: the record that it went out is the `outbound_emails` row, with its
// recipients, its body and its send status.
//
// Consequence, said out loud: a chase does not appear on any item's timeline
// or in the client's Activity column. What it carries is the stage-count block
// the email shell already renders, which is the same three buckets the client
// sees when they land — so nothing in it can drift from their page.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { buildChaseEmail } from "@/lib/client-email";
import { fetchStageCounts } from "@/lib/client-stage-counts";
import { LINK_DAYS, sendOnPersonalLink, type OutboundContact } from "@/lib/client-outbound";

export type ChaseInput = {
  clientId: string;
  /** The covering line, as typed. The counts do the counting. */
  message: string;
  recipients: OutboundContact[];
};

export function useSendClientChase() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: ChaseInput): Promise<{ failures: string[] }> => {
      // send-outbound-email sends as the signed-in person and stamps
      // outbound_emails.composed_by, which is NOT NULL. The shared team@ login
      // resolves to null and genuinely cannot send.
      if (!currentUserId) {
        throw new Error(
          "Sign in with your own account to send an update. The shared team@ login has no sender to attribute it to.",
        );
      }
      const message = input.message.trim();
      if (!message) throw new Error("Write something to send.");
      if (input.recipients.length === 0) throw new Error("Pick at least one person.");

      const counts = await fetchStageCounts(input.clientId);
      const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
      const failures: string[] = [];

      for (const person of input.recipients) {
        const { sendError } = await sendOnPersonalLink({
          clientId: input.clientId,
          contact: person,
          label: `${person.name ?? person.email} — update`,
          expiresAt,
          createdBy: currentUserId,
          template: "client_update",
          build: (url) =>
            buildChaseEmail({ message, url, contactName: person.name, counts }),
        });
        if (sendError) failures.push(sendError);
      }

      // Nothing got out. There is no half-success to report and no row on the
      // client's page to point at, so this is a failure, not a warning.
      if (failures.length === input.recipients.length) throw new Error(failures.join("; "));
      return { failures };
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: ["client-review-links", input.clientId] });
      void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
      // A chase mints a link, so "they have no live link" on the page above
      // has just stopped being true. Same reason useClientAsks invalidates it.
      void qc.invalidateQueries({ queryKey: ["client-review-link-counts"] });
    },
  });
}
