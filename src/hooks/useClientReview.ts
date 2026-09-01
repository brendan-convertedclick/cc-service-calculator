// src/hooks/useClientReview.ts
//
// Data layer for the client-facing sign-off inbox (/review/:token). Every
// read and write goes through the `client-review` edge function on the
// service role — this file never touches Postgres directly, so there is no
// PostgrestError to normalise: callEdgeFn already throws a clean Error, and
// that's what errorMessage(e) renders downstream (the page's Network/500
// copy — see the spec's §7, "the only place errorMessage(e) renders").

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { callEdgeFn } from "@/lib/edge";
import type {
  DecideRequest,
  DecideResponse,
  ListRequest,
  ListResponse,
  RememberedApprover,
  ReplyRequest,
  ReplyResponse,
  ReviewDecisionInput,
} from "@/types/client-review";

const reviewKey = (token: string) => ["client-review", token] as const;

/**
 * The one read. Never retries a token failure (it is a 200, so React Query
 * cannot tell — set retry: 1 and let the union carry the meaning).
 * queryKey: ["client-review", token]
 */
export function useReviewList(token: string): UseQueryResult<ListResponse, Error> {
  return useQuery({
    queryKey: reviewKey(token),
    retry: 1,
    queryFn: () =>
      callEdgeFn<ListResponse>("client-review", {
        action: "list",
        token,
      } satisfies ListRequest),
  });
}

/**
 * The one write. On a "ok" / "already_decided" result it invalidates
 * ["client-review", token]. Token failures and "invalid" are returned, not
 * thrown; only network/500 rejects.
 * Read in-flight per row with:
 *   m.isPending && m.variables?.item_id === row.id
 */
export function useReviewDecision(
  token: string,
): UseMutationResult<DecideResponse, Error, ReviewDecisionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewDecisionInput) =>
      callEdgeFn<DecideResponse>("client-review", {
        action: "decide",
        token,
        ...input,
      } satisfies DecideRequest),
    onSuccess: (data) => {
      // Nothing changed on a token failure or an "invalid" (missing
      // comment / unknown contact / unknown item) — only a real state
      // transition is worth a refetch.
      if (data.status === "ok" || data.status === "already_decided") {
        qc.invalidateQueries({ queryKey: reviewKey(token) });
      }
    },
  });
}

/**
 * A client writes back on an item. Deliberately separate from the decision
 * mutation: replying leaves the item pending, so nothing about the state
 * machine moves and the invalidation is only there to show the new message.
 */
export function useReviewReply(
  token: string,
): UseMutationResult<ReplyResponse, Error, { item_id: string; body: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { item_id: string; body: string }) =>
      callEdgeFn<ReplyResponse>("client-review", {
        action: "reply",
        token,
        ...input,
      } satisfies ReplyRequest),
    onSuccess: (data) => {
      if (data.status === "ok") qc.invalidateQueries({ queryKey: reviewKey(token) });
    },
  });
}

function approverStorageKey(token: string): string {
  return `cc-review-approver:${token}`;
}

function readApprover(token: string): RememberedApprover | null {
  try {
    // The accessor itself (not just a missing key) is what throws in a
    // private window or a cookie-blocked context, so it has to be inside
    // the try, not just the JSON.parse.
    const raw = sessionStorage.getItem(approverStorageKey(token));
    return raw ? (JSON.parse(raw) as RememberedApprover) : null;
  } catch {
    return null;
  }
}

/**
 * "Remember who I am for the rest of this browser session."
 * sessionStorage (not localStorage — a shared office machine must not
 * remember a name next week), keyed `cc-review-approver:${token}` so a browser
 * holding links for two companies never pre-fills one on the other.
 * BOTH the read and the write are wrapped in try/catch: private windows and
 * cookie-blocked contexts throw on the accessor, they do not return null.
 */
export function useRememberedApprover(
  token: string,
): readonly [RememberedApprover | null, (approver: RememberedApprover) => void] {
  const [approver, setApproverState] = useState<RememberedApprover | null>(() =>
    readApprover(token),
  );

  const setApprover = useCallback(
    (next: RememberedApprover) => {
      setApproverState(next);
      try {
        sessionStorage.setItem(approverStorageKey(token), JSON.stringify(next));
      } catch {
        // Same private-window case as the read: remembering silently fails
        // and every later decision just asks "And you are?" again.
      }
    },
    [token],
  );

  return [approver, setApprover] as const;
}
