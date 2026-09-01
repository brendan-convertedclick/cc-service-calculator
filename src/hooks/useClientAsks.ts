// src/hooks/useClientAsks.ts
//
// The two things staff can put in front of a client that are NOT a sign-off.
//
//   A QUESTION is something we asked and they must ANSWER. It goes out as an
//   email the moment it is written, because a question nobody sends is not a
//   question. The answer comes back as client_note on the same row.
//
//   An AGREEMENT is something THEY committed to — in a meeting, on a call, in
//   an email — by a date. Nothing is sent: it is a record, written down while
//   it is fresh so that chasing it later is a fact rather than a feeling.
//
// Both are client_approvals rows. See the note in 0141 on why they are not
// their own tables: the client portal reads exactly one table, and a question
// stored anywhere else is a question the client never sees.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import { buildQuestionEmail } from "@/lib/client-email";
import { fetchStageCounts } from "@/lib/client-stage-counts";
import { newPlaintextToken, reviewUrlFor, sha256Hex } from "@/hooks/useClientReviewLinks";

/**
 * How long a link minted by a question email stays alive.
 *
 * Every question mints its own token — the store is hash-only, so an existing
 * link cannot be recovered to reuse. Without an expiry a client would
 * accumulate one permanently live link per question ever asked. Sixty days is
 * long enough that nobody is locked out of a thread they are still working,
 * and short enough that a two-year-old email is not a key to their account.
 */
const QUESTION_LINK_DAYS = 60;

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
  void qc.invalidateQueries({ queryKey: ["client-review-preview"] });
  void qc.invalidateQueries({ queryKey: ["client-review-link-counts"] });
}

export type AskQuestionInput = {
  clientId: string;
  /** What the question is about. Client-facing — never a raw ClickUp subject. */
  title: string;
  question: string;
  dueDate: string | null;
  /**
   * Who it goes to. At least one. Each gets their OWN email carrying their OWN
   * link — see the note on the mutation.
   */
  recipients: { id: string; email: string; name: string | null }[];
  briefId?: string | null;
};

/**
 * Create the question, mint a link per recipient, send each of them their own
 * email.
 *
 * ONE LINK PER PERSON, NOT ONE PER SEND (0142). A personal token is what makes
 * the answer attributable: the review page greets them by name, never asks who
 * they are, and the server records the signer from the token rather than from
 * anything the browser claims. Two people on one shared link would give an
 * answer nobody can be held to — so two recipients means two tokens and two
 * emails, which is also the more normal-looking message to receive.
 *
 * ORDER MATTERS AND IS DELIBERATE. The row is written first, so the page the
 * link opens already has the question on it when the client arrives. If the
 * send then fails, what survives is a question the client cannot see yet —
 * visible to staff as "not sent" on the sign-offs table, which is recoverable.
 * The other order risks the opposite: an email inviting someone to answer a
 * question that does not exist.
 */
export function useAskClientQuestion() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (
      input: AskQuestionInput,
    ): Promise<{ url: string; failures: string[] }> => {
      // send-outbound-email sends as the signed-in person and stamps
      // outbound_emails.composed_by, which is NOT NULL. The shared team@ login
      // resolves currentUserId to null, so it genuinely cannot send — say so
      // rather than failing inside the edge function with a FK error.
      if (!currentUserId) {
        throw new Error(
          "Sign in with your own account to send a question — the shared team@ login has no sender to attribute it to.",
        );
      }
      const to = input.recipients.map((r) => r.email.trim()).filter(Boolean);
      if (to.length === 0) throw new Error("Pick at least one person to send this to.");

      const title = input.title.trim();
      const question = input.question.trim();
      if (!title || !question) throw new Error("A question needs both a subject and a question.");

      // 1. the question itself, before anything invites anyone to answer it
      const { data: approval, error: approvalErr } = await supabase
        .from("client_approvals")
        .insert({
          client_id: input.clientId,
          brief_id: input.briefId ?? null,
          item_type: "question",
          client_title: title,
          ask: question,
          due_date: input.dueDate,
          created_by: currentUserId,
        })
        .select("id")
        .single();
      if (approvalErr) throw new Error(errorMessage(approvalErr));
      const approvalId = (approval as { id: string }).id;

      // Counted AFTER the row above, so the question being asked is included —
      // "3 waiting on you" that silently excludes the one you are reading is
      // the kind of small lie that gets a whole feature ignored.
      const counts = await fetchStageCounts(input.clientId);

      const expiresAt = new Date(Date.now() + QUESTION_LINK_DAYS * 86_400_000).toISOString();
      let firstOutboundId: string | null = null;
      let firstUrl = "";
      const failures: string[] = [];

      for (const person of input.recipients) {
        // 2. this person's own link
        const token = newPlaintextToken();
        const { error: tokenErr } = await supabase.from("client_review_tokens").insert({
          client_id: input.clientId,
          contact_id: person.id,
          token_hash: await sha256Hex(token),
          label: `${person.name ?? person.email} — ${title}`.slice(0, 120),
          expires_at: expiresAt,
          created_by: currentUserId,
        });
        if (tokenErr) throw new Error(errorMessage(tokenErr));
        const url = reviewUrlFor(token);
        if (!firstUrl) firstUrl = url;

        // 3. their own email
        const mail = buildQuestionEmail({
          title,
          question,
          url,
          dueDate: input.dueDate,
          contactName: person.name,
          counts,
        });
        const { data: outbound, error: outboundErr } = await supabase
          .from("outbound_emails")
          .insert({
            client_id: input.clientId,
            brief_id: input.briefId ?? null,
            composed_by: currentUserId,
            to_addresses: [person.email],
            subject: mail.subject,
            body_text: mail.bodyText,
            body_html: mail.bodyHtml,
            approval_link: url,
            template: "client_question",
            status: "draft",
          })
          .select("id")
          .single();
        if (outboundErr) throw new Error(errorMessage(outboundErr));
        const outboundId = (outbound as { id: string }).id;
        if (!firstOutboundId) {
          firstOutboundId = outboundId;
          await supabase
            .from("client_approvals")
            .update({ outbound_email_id: outboundId })
            .eq("id", approvalId);
        }

        // 4. send. Collected rather than thrown, so one bad address does not
        //    strand the people whose emails would have gone out after it.
        try {
          await callEdgeFn("send-outbound-email", { outbound_email_id: outboundId });
        } catch (e) {
          failures.push(`${person.email}: ${errorMessage(e)}`);
        }
      }

      if (failures.length === input.recipients.length) {
        throw new Error(failures.join("; "));
      }
      return { url: firstUrl, failures };
    },
    onSuccess: () => invalidate(qc),
    // The question row may exist even on failure; the table must show it.
    onError: () => invalidate(qc),
  });
}

export type AgreementInput = {
  clientId: string;
  /**
   * Whose promise it is. "us" is the half 0141 could not hold: plenty of what
   * gets agreed in a meeting is ours, and a list of commitments that only
   * records theirs is not a record of the meeting.
   */
  owedBy: "client" | "us";
  /** What was agreed. */
  title: string;
  detail: string;
  /** When they said they'd have it done. */
  dueDate: string | null;
  /** When they agreed — usually the meeting date, not today. */
  agreedAt: string;
  agreedVia: "meeting" | "call" | "email" | "message" | "other";
};

/** Write down what was agreed, by either side. No email — this is a record. */
export function useLogClientAgreement() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: AgreementInput): Promise<void> => {
      const title = input.title.trim();
      if (!title) throw new Error("Say what they agreed to.");

      const { error } = await supabase.from("client_approvals").insert({
        client_id: input.clientId,
        item_type: "agreement",
        owed_by: input.owedBy,
        client_title: title,
        // The client reads this as "what we need from you", so it is phrased
        // as the ask it is, not as a minute of the meeting.
        ask: input.detail.trim() || title,
        due_date: input.dueDate,
        agreed_at: input.agreedAt,
        agreed_via: input.agreedVia,
        created_by: currentUserId ?? null,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => invalidate(qc),
  });
}

/**
 * Turn an agreement WE made into a real task.
 *
 * It creates the `briefs` row and stops there, deliberately: the brief is what
 * `QuickBriefSheet` already knows how to turn into a ClickUp task, with the
 * work stream, points, assignee, list and checklist it needs. Rebuilding that
 * form here would be a second copy of the one screen everybody already knows,
 * and it would drift.
 *
 * The agreement keeps its own life — it stays on the client's page under "With
 * us" until somebody marks it done — and `brief_id` links the two, so "what
 * did this become" has an answer.
 */
export function useAgreementToBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      approvalId: string;
      clientId: string;
      title: string;
      detail: string | null;
      dueDate: string | null;
    }): Promise<{ briefId: string }> => {
      const { data, error } = await supabase
        .from("briefs")
        .insert({
          client_id: input.clientId,
          source: "manual",
          // raw_subject is the staff-facing name and is what QuickBriefSheet
          // seeds the task name from; the client-facing wording stays on the
          // agreement itself.
          raw_subject: input.title,
          raw_body: input.detail?.trim() || input.title,
          status: "new",
          original_due_date: input.dueDate,
        })
        .select("id")
        .single();
      if (error) throw new Error(errorMessage(error));
      const briefId = (data as { id: string }).id;

      const { error: linkErr } = await supabase
        .from("client_approvals")
        .update({ brief_id: briefId })
        .eq("id", input.approvalId);
      if (linkErr) throw new Error(errorMessage(linkErr));

      return { briefId };
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: ["client-signoffs"] });
      void qc.invalidateQueries({ queryKey: ["client-activity", input.approvalId] });
      void qc.invalidateQueries({ queryKey: ["briefs"] });
    },
  });
}
