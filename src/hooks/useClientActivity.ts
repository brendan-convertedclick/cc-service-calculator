// src/hooks/useClientActivity.ts
//
// The timeline behind one sign-off item, and the two ways to add to it.
//
// Reading is a merge of four sources, three of which already existed — see
// src/lib/client-timeline.ts for why nothing is duplicated into an event
// table. Writing is either a MESSAGE (goes out as email, on their own personal
// link, and lands on their sign-off page) or a NOTE (never leaves this
// database). Those two must never be confusable, which is why they are
// different verbs here and different colours in the panel.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import { buildMessageEmail } from "@/lib/client-email";
import { fetchStageCounts } from "@/lib/client-stage-counts";
import { newPlaintextToken, reviewUrlFor, sha256Hex } from "@/hooks/useClientReviewLinks";
import {
  buildTimeline,
  type ActivityRow,
  type TimelineEvent,
  type TimelineSource,
} from "@/lib/client-timeline";

/** Matches QUESTION_LINK_DAYS in useClientAsks — one rotation story, not two. */
const LINK_DAYS = 60;

const KEY = (approvalId: string) => ["client-activity", approvalId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, approvalId: string) {
  void qc.invalidateQueries({ queryKey: KEY(approvalId) });
  void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
}

export function useApprovalTimeline(approvalId: string | undefined) {
  return useQuery({
    queryKey: KEY(approvalId ?? ""),
    enabled: !!approvalId,
    queryFn: async (): Promise<TimelineEvent[]> => {
      const { data: approvalRaw, error: approvalErr } = await supabase
        .from("client_approvals")
        .select(
          "client_id, created_at, state, item_type, decided_at, decided_by_name, client_note, outbound_email_id",
        )
        .eq("id", approvalId!)
        .single();
      if (approvalErr) throw new Error(errorMessage(approvalErr));
      const approval = approvalRaw as {
        client_id: string;
        created_at: string;
        state: string;
        item_type: string;
        decided_at: string | null;
        decided_by_name: string | null;
        client_note: string | null;
        outbound_email_id: string | null;
      };

      const [activityRes, emailRes, tokenRes] = await Promise.all([
        supabase
          .from("client_activity")
          .select(
            "id, kind, body, created_at, outbound_email_id, created_by, author_name, from_state, to_state, team_members(full_name)",
          )
          .eq("approval_id", approvalId!)
          .order("created_at"),
        approval.outbound_email_id
          ? supabase
              .from("outbound_emails")
              .select("sent_at, to_addresses, status, send_error")
              .eq("id", approval.outbound_email_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        // Per-person links (0142): last_used_at already answers "has anyone
        // there actually opened this", and now says who. Only personal,
        // unrevoked links count — a shared link tells us nothing about who.
        supabase
          .from("client_review_tokens")
          .select("last_used_at, contacts(full_name)")
          .eq("client_id", approval.client_id)
          .not("contact_id", "is", null)
          .not("last_used_at", "is", null)
          .is("revoked_at", null),
      ]);

      if (activityRes.error) throw new Error(errorMessage(activityRes.error));
      if (emailRes.error) throw new Error(errorMessage(emailRes.error));
      if (tokenRes.error) throw new Error(errorMessage(tokenRes.error));

      const rows: ActivityRow[] = (activityRes.data ?? []).map((r) => {
        const author = (r as typeof r & { team_members: { full_name: string } | null })
          .team_members;
        return {
          id: r.id,
          kind: r.kind,
          body: r.body,
          created_at: r.created_at,
          outbound_email_id: r.outbound_email_id,
          // A client's reply carries its own snapshotted name; ours reads
          // through created_by. One field, two sources, by design.
          author_name: r.author_name ?? author?.full_name ?? null,
          from_state: r.from_state,
          to_state: r.to_state,
        };
      });

      const email = emailRes.data as {
        sent_at: string | null;
        to_addresses: string[] | null;
        status: string;
        send_error: string | null;
      } | null;

      // One row per person, newest open wins — the same contact can hold
      // several links (a new one is minted per question) and "when did she
      // last look" is one answer, not four.
      const latestByName = new Map<string, string>();
      for (const t of tokenRes.data ?? []) {
        const name = (t as typeof t & { contacts: { full_name: string | null } | null }).contacts
          ?.full_name;
        const at = t.last_used_at;
        if (!name || !at) continue;
        const seen = latestByName.get(name);
        if (!seen || at > seen) latestByName.set(name, at);
      }

      const source: TimelineSource = {
        created_at: approval.created_at,
        state: approval.state,
        item_type: approval.item_type,
        decided_at: approval.decided_at,
        decided_by_name: approval.decided_by_name,
        client_note: approval.client_note,
        emailed_at: email?.status === "sent" ? email.sent_at : null,
        emailed_to: email?.to_addresses ?? null,
        email_failed: email && email.status !== "sent" ? (email.send_error ?? "Not sent") : null,
        opens: [...latestByName.entries()].map(([name, at]) => ({ name, at })),
      };

      return buildTimeline(source, rows);
    },
  });
}

export type SendMessageInput = {
  approvalId: string;
  clientId: string;
  /** The item's client-facing title — becomes the email subject. */
  title: string;
  message: string;
  recipients: { id: string; email: string; name: string | null }[];
};

/**
 * Message the client about this item. Each recipient gets their own email on
 * their own freshly-minted personal link, for the same reason questions do
 * (0142): a shared link produces a reply nobody can be held to.
 *
 * The activity row is written FIRST and always — a message we sent is part of
 * the history whether or not the mail server cooperated, and a chase that
 * vanishes because an address bounced is how the same client gets chased twice.
 */
export function useSendClientMessage() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: SendMessageInput): Promise<{ failures: string[] }> => {
      if (!currentUserId) {
        throw new Error(
          "Sign in with your own account to message a client — the shared team@ login has no sender to attribute it to.",
        );
      }
      const body = input.message.trim();
      if (!body) throw new Error("Write something to send.");
      if (input.recipients.length === 0) throw new Error("Pick at least one person.");

      const { data: activity, error: activityErr } = await supabase
        .from("client_activity")
        .insert({
          client_id: input.clientId,
          approval_id: input.approvalId,
          kind: "message",
          body,
          created_by: currentUserId,
        })
        .select("id")
        .single();
      if (activityErr) throw new Error(errorMessage(activityErr));
      const activityId = (activity as { id: string }).id;

      const counts = await fetchStageCounts(input.clientId);
      const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
      const failures: string[] = [];
      let firstOutboundId: string | null = null;

      for (const person of input.recipients) {
        const token = newPlaintextToken();
        const { error: tokenErr } = await supabase.from("client_review_tokens").insert({
          client_id: input.clientId,
          contact_id: person.id,
          token_hash: await sha256Hex(token),
          label: `${person.name ?? person.email} — ${input.title}`.slice(0, 120),
          expires_at: expiresAt,
          created_by: currentUserId,
        });
        if (tokenErr) throw new Error(errorMessage(tokenErr));
        const url = reviewUrlFor(token);

        const mail = buildMessageEmail({
          title: input.title,
          message: body,
          url,
          contactName: person.name,
          counts,
        });
        const { data: outbound, error: outboundErr } = await supabase
          .from("outbound_emails")
          .insert({
            client_id: input.clientId,
            composed_by: currentUserId,
            to_addresses: [person.email],
            subject: mail.subject,
            body_text: mail.bodyText,
            body_html: mail.bodyHtml,
            approval_link: url,
            template: "client_message",
            status: "draft",
          })
          .select("id")
          .single();
        if (outboundErr) throw new Error(errorMessage(outboundErr));
        const outboundId = (outbound as { id: string }).id;
        if (!firstOutboundId) {
          firstOutboundId = outboundId;
          await supabase
            .from("client_activity")
            .update({ outbound_email_id: outboundId })
            .eq("id", activityId);
        }

        try {
          await callEdgeFn("send-outbound-email", { outbound_email_id: outboundId });
        } catch (e) {
          failures.push(`${person.email}: ${errorMessage(e)}`);
        }
      }

      return { failures };
    },
    onSuccess: (_r, input) => invalidate(qc, input.approvalId),
    onError: (_e, input) => invalidate(qc, input.approvalId),
  });
}

/** An internal note. Never emailed, never shown to a client. */
export function useAddClientNote() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: { approvalId: string; clientId: string; body: string }) => {
      const body = input.body.trim();
      if (!body) throw new Error("Write something first.");
      const { error } = await supabase.from("client_activity").insert({
        client_id: input.clientId,
        approval_id: input.approvalId,
        kind: "note",
        body,
        created_by: currentUserId ?? null,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_r, input) => invalidate(qc, input.approvalId),
  });
}

/**
 * Close an agreement WE made.
 *
 * It reuses the same `approved` state every other settled item lands in, so
 * the client sees it move to "Signed off" with everything else — but the
 * signer is us, and decided_by_name says so rather than putting a client
 * contact's name against something they had no part in. The frozen text
 * columns (0142) are filled here too: a commitment can be edited afterwards
 * just like an ask can.
 */
export function useCloseOurAgreement() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: { approvalId: string }) => {
      const { data: current, error: readErr } = await supabase
        .from("client_approvals")
        .select("client_title, ask, owed_by, state")
        .eq("id", input.approvalId)
        .single();
      if (readErr) throw new Error(errorMessage(readErr));
      const row = current as { client_title: string; ask: string; owed_by: string; state: string };
      if (row.owed_by !== "us") throw new Error("Only an agreement we made is ours to close.");
      if (row.state !== "pending") throw new Error("This one is already closed.");

      let name = "Converted Click";
      if (currentUserId) {
        const { data: me } = await supabase
          .from("team_members")
          .select("full_name")
          .eq("id", currentUserId)
          .maybeSingle();
        const full = (me as { full_name: string | null } | null)?.full_name;
        if (full) name = `${full} (Converted Click)`;
      }

      const { error } = await supabase
        .from("client_approvals")
        .update({
          state: "approved",
          decided_at: new Date().toISOString(),
          decided_by_name: name,
          decided_title: row.client_title,
          decided_ask: row.ask,
        })
        .eq("id", input.approvalId)
        .eq("state", "pending");
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_r, input) => invalidate(qc, input.approvalId),
  });
}

/** The three states staff can move an item between, in the team's words. */
export const ITEM_STATES = [
  { value: "pending", label: "Waiting on client" },
  { value: "changes_requested", label: "Back with us" },
  { value: "approved", label: "Signed off" },
] as const;

export type ItemState = (typeof ITEM_STATES)[number]["value"];

/**
 * Move an item by hand, and record that somebody did.
 *
 * Two DB rules make this less free-form than it looks. `client_approvals_
 * decided_chk` requires state and decided_at to move together, so reopening
 * must clear the stamp and settling must set one — half-updating leaves a row
 * the database will not accept. And the frozen `decided_title`/`decided_ask`
 * (0142) are filled on the way in, because a staff decision is as much a
 * record of what was agreed as a client's.
 *
 * The status row is written AFTER the update succeeds. A timeline claiming a
 * move that did not happen is worse than a move with no timeline entry.
 */
export function useSetItemState() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      approvalId: string;
      clientId: string;
      to: ItemState;
      reason?: string;
    }) => {
      const { data: currentRaw, error: readErr } = await supabase
        .from("client_approvals")
        .select("state, client_title, ask")
        .eq("id", input.approvalId)
        .single();
      if (readErr) throw new Error(errorMessage(readErr));
      const current = currentRaw as { state: string; client_title: string; ask: string };
      if (current.state === input.to) return;

      let name = "Converted Click";
      if (currentUserId) {
        const { data: me } = await supabase
          .from("team_members")
          .select("full_name")
          .eq("id", currentUserId)
          .maybeSingle();
        const full = (me as { full_name: string | null } | null)?.full_name;
        if (full) name = full;
      }

      const settling = input.to !== "pending";
      const { error } = await supabase
        .from("client_approvals")
        .update(
          settling
            ? {
                state: input.to,
                decided_at: new Date().toISOString(),
                decided_by_name: `${name} (Converted Click)`,
                decided_title: current.client_title,
                decided_ask: current.ask,
              }
            : {
                // Reopening clears the whole decision, not just the state —
                // leaving a name and a timestamp on something nobody has
                // decided is how a record stops being one.
                state: "pending",
                decided_at: null,
                decided_by_name: null,
                decided_by_email: null,
                decided_by_contact_id: null,
              },
        )
        .eq("id", input.approvalId);
      if (error) throw new Error(errorMessage(error));

      const { error: logErr } = await supabase.from("client_activity").insert({
        client_id: input.clientId,
        approval_id: input.approvalId,
        kind: "status",
        from_state: current.state,
        to_state: input.to,
        body: input.reason?.trim() || null,
        author_name: name,
        created_by: currentUserId ?? null,
      });
      if (logErr) throw new Error(errorMessage(logErr));
    },
    onSuccess: (_r, input) => invalidate(qc, input.approvalId),
  });
}
