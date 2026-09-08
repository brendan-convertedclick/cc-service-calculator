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
import { errorMessage } from "@/lib/utils";
import { buildQuestionEmail } from "@/lib/client-email";
import { fetchStageCounts } from "@/lib/client-stage-counts";
import { LINK_DAYS, sendOnPersonalLink } from "@/lib/client-outbound";

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

      const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
      let firstOutboundId: string | null = null;
      let firstUrl = "";
      const failures: string[] = [];

      for (const person of input.recipients) {
        // 2, 3 and 4 — this person's own link, their own letter on it, and the
        //    send, which is collected rather than thrown so one bad address
        //    does not strand the people queued behind it. See client-outbound.
        const { url, outboundId, sendError } = await sendOnPersonalLink({
          clientId: input.clientId,
          briefId: input.briefId ?? null,
          contact: person,
          label: `${person.name ?? person.email} — ${title}`,
          expiresAt,
          createdBy: currentUserId,
          template: "client_question",
          build: (link) =>
            buildQuestionEmail({
              title,
              question,
              url: link,
              dueDate: input.dueDate,
              contactName: person.name,
              counts,
            }),
        });
        if (!firstUrl) firstUrl = url;
        if (!firstOutboundId) {
          firstOutboundId = outboundId;
          await supabase
            .from("client_approvals")
            .update({ outbound_email_id: outboundId })
            .eq("id", approvalId);
        }
        if (sendError) failures.push(sendError);
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

export type IdeaInput = {
  clientId: string;
  /** Whose idea it is to act on when the time comes. */
  owedBy: "client" | "us";
  title: string;
  detail: string;
  /** When to look at it again. Optional — most ideas have no date, that is why they are ideas. */
  reviewOn: string | null;
};

/**
 * Park an idea: something worth doing that nobody is doing yet.
 *
 * Nothing is sent and nothing is due. It is the third thing that comes out of
 * a client meeting, after the asks and the commitments — the one that used to
 * live in somebody's head because the list had nowhere to put it.
 *
 * It is written as item_type='idea', state='parked' (0148), which is what
 * keeps it off the client's page: the review function filters parked rows out
 * of the list, and the database refuses to let an idea be anything but parked.
 * When the time IS right it does not get un-parked — it gets asked properly,
 * as a question, an agreement or a brief, which is the act of deciding what it
 * actually is.
 */
export function useParkIdea() {
  const qc = useQueryClient();
  const { currentUserId } = useAuth();

  return useMutation({
    mutationFn: async (input: IdeaInput): Promise<void> => {
      const title = input.title.trim();
      if (!title) throw new Error("Say what the idea is.");

      const { error } = await supabase.from("client_approvals").insert({
        client_id: input.clientId,
        item_type: "idea",
        state: "parked",
        owed_by: input.owedBy,
        client_title: title,
        // `ask` is NOT NULL and is the one-line body everywhere else, so the
        // note goes there and the title stands in when there is no note.
        ask: input.detail.trim() || title,
        due_date: input.reviewOn,
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

/**
 * The rest of the CRUD on an ask: change its wording, its date, its links — or
 * take it off the list altogether.
 *
 * Update deliberately touches SIX columns and no more. `item_type`, `state` and
 * `owed_by` each have check constraints hanging off them (an idea must be
 * parked, an event must be noted, only an agreement may be owed by us, a
 * decision must move with its stamp), so changing them is a different act with
 * its own controls — useSetItemState for the state, and nothing at all for the
 * type: an idea that turns out to be a question is asked as one, which is the
 * point of 0148.
 *
 * Editing after a decision is allowed and does not rewrite history: 0142 froze
 * decided_title/decided_ask at the click, and EvidenceDialog shows the frozen
 * copy with a warning when the live wording has drifted from it.
 */
export type UpdateApprovalInput = {
  approvalId: string;
  patch: {
    client_title?: string;
    ask?: string;
    detail?: string | null;
    due_date?: string | null;
    weighty?: boolean;
    links?: string[];
  };
};

export function useUpdateApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ approvalId, patch }: UpdateApprovalInput) => {
      const { error } = await supabase
        .from("client_approvals")
        .update(patch)
        .eq("id", approvalId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: (_r, input) => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: ["client-activity", input.approvalId] });
    },
  });
}

/**
 * Delete an ask outright.
 *
 * It takes the whole thread with it — client_activity cascades on the FK — and
 * that includes messages we actually emailed to somebody. There is no undo and
 * no soft-delete column, so the confirm in the UI names what is going, and a
 * settled row says so twice: a signed-off approval is EVIDENCE (0142) that the
 * client agreed to something, and deleting it destroys the record rather than
 * the task.
 *
 * A school_tasks row pointing at it survives — that FK is ON DELETE SET NULL,
 * so the plan keeps its line and simply stops being an ask.
 */
export function useDeleteApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (approvalId: string) => {
      const { error } = await supabase.from("client_approvals").delete().eq("id", approvalId);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => invalidate(qc),
  });
}
