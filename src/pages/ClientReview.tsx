import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ItemDetail } from "@/components/review/ItemDetail";
import { IdentityDialog } from "@/components/review/IdentityDialog";
import { QueueRow } from "@/components/review/QueueRow";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  useRememberedApprover,
  useReviewDecision,
  useReviewList,
  useReviewReply,
} from "@/hooks/useClientReview";
import { useClientReviewPreview } from "@/hooks/useClientSignoffs";
import { bucketCounts, bucketOf, formatAsAt, isOverdue, REVIEW_REPLY_TO, sortForQueue } from "@/lib/client-review";
import { cn, errorMessage } from "@/lib/utils";
import {
  isTokenFailure,
  type DecideResponse,
  type RememberedApprover,
  type ReviewBucket,
  type ReviewDecision,
  type ReviewIdentity,
  type TokenFailure,
} from "@/types/client-review";

const BUCKETS: { id: ReviewBucket; label: string }[] = [
  { id: "your-move", label: "Your move" },
  { id: "with-us", label: "With us" },
  { id: "signed-off", label: "Signed off" },
];

const EMPTY_BUCKET_COPY: Record<ReviewBucket, [string, string]> = {
  "your-move": ["Nothing needs you right now.", "We'll email you the moment something does."],
  "with-us": [
    "Nothing's with us right now.",
    "Anything you've sent back will show here while we work on it.",
  ],
  "signed-off": [
    "Nothing signed off yet.",
    "Once you approve something it'll stay here for your records.",
  ],
};

const TOKEN_FAILURE_COPY: Record<TokenFailure["status"], { title: string; body: string }> = {
  expired: {
    title: "This link has expired.",
    body: "Sign-off links time out after a while to keep your account safe. Reply to the email that brought you here and we'll send you a fresh one straight away.",
  },
  revoked: {
    title: "This link has been switched off.",
    body: "It was replaced, most likely with a newer one. Check for a more recent email from us, or just reply to this thread and we'll send a new link.",
  },
  unknown: {
    title: "We don't recognise this link.",
    body: "It may have been copied only halfway, or shortened by a mail app along the way. Try opening it from the original email — and if it still won't open, reply to that email and we'll sort it out.",
  },
};

const INVALID_COPY = {
  missing_comment: "Add a note so we know what to change.",
  unknown_contact: "We couldn't match that name — pick again?",
  unknown_item: "That item isn't on your list any more.",
} as const;

function approverToIdentity(approver: RememberedApprover): ReviewIdentity {
  return approver.contact_id
    ? { contact_id: approver.contact_id }
    : { name: approver.name, email: approver.email ?? undefined };
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-m-background p-6">
      <Card className="max-w-md bg-m-surface p-6">{children}</Card>
    </div>
  );
}

/**
 * The client-facing sign-off inbox. No login (the token in the URL is the
 * auth), no staff identity anywhere on the page — the only two parties are
 * the client's own contacts and "Converted Click".
 *
 * `previewClientId` switches the data source to a staff session (see
 * /client-signoffs) while leaving every pixel of the rendering alone. That is
 * the whole point: staff review the real screen, not a lookalike that can
 * drift from it. Decisions are intercepted rather than hidden — the buttons
 * must still look exactly as the client sees them.
 */
export function ClientReview({
  previewClientId,
  onSelectedItemChange,
}: {
  previewClientId?: string;
  /**
   * Preview only. Reports which item the queue has selected so the STAFF page
   * can show its activity beside this one. The client-facing route never
   * passes it, and nothing about the rendering changes either way — this is a
   * read-only tap on the selection, not a second behaviour.
   */
  onSelectedItemChange?: (id: string | null) => void;
} = {}) {
  const { token = "" } = useParams<{ token: string }>();
  const preview = !!previewClientId;
  const tokenQuery = useReviewList(preview ? "" : token);
  const previewQuery = useClientReviewPreview(previewClientId);
  const listQuery = preview ? previewQuery : tokenQuery;
  const decisionMutation = useReviewDecision(token);
  const replyMutation = useReviewReply(token);
  const [remembered, setRemembered] = useRememberedApprover(token);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [bucket, setBucket] = useState<ReviewBucket>("your-move");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{
    itemId: string;
    decision: ReviewDecision;
    comment?: string;
  } | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const data = listQuery.data;
  const ok = data?.status === "ok" ? data : null;

  // Who is acting. A personal link (0142) answers this outright and outranks
  // anything remembered from a picker earlier in the session — the server
  // resolves the signer from the token regardless, so showing a different name
  // back to them would be a lie about what gets recorded.
  const signedIn = ok?.signed_in_as ?? null;
  const approver: RememberedApprover | null = signedIn
    ? { contact_id: signedIn.id, name: signedIn.full_name, email: null }
    : remembered;
  const items = ok?.items ?? [];
  const sorted = sortForQueue(items);
  const counts = bucketCounts(items);
  const bucketItems = sorted.filter((item) => bucketOf(item) === bucket);
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  // Auto-open the first item in "Your move" the moment the list first
  // loads — once only, so a decision later on never yanks the client away
  // from the item they just acted on (that item simply leaves the bucket
  // filter; selection is untouched until the client picks something else).
  // Report the selection outward whenever it moves. An effect rather than a
  // call inside each setSelectedId, so the auto-open on first load is reported
  // too — that is the item staff will be looking at.
  useEffect(() => {
    onSelectedItemChange?.(selectedId);
  }, [selectedId, onSelectedItemChange]);

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !ok) return;
    didInit.current = true;
    // Desktop only — on mobile this selection would pop the Sheet open over
    // a queue the client hasn't seen yet. A phone visitor lands on the list.
    if (!isDesktop) return;
    const first = sortForQueue(ok.items).filter((item) => bucketOf(item) === "your-move")[0];
    if (first) setSelectedId(first.id);
  }, [ok, isDesktop]);

  function selectBucket(next: ReviewBucket) {
    setBucket(next);
    setDecisionError(null);
    // Same reasoning as above: jump to the bucket's first item on desktop
    // (there's always a detail column to fill), but a bucket-chip tap on
    // mobile should just filter the list, not launch the Sheet.
    const nextItems = sorted.filter((item) => bucketOf(item) === next);
    setSelectedId(isDesktop ? (nextItems[0]?.id ?? null) : null);
  }

  function handleSelect(id: string) {
    setDecisionError(null);
    setReplyError(null);
    setSelectedId(id);
  }

  function fireDecision(
    itemId: string,
    decision: ReviewDecision,
    comment: string | undefined,
    identityOf: RememberedApprover,
  ) {
    decisionMutation.mutate(
      { item_id: itemId, decision, comment, identity: approverToIdentity(identityOf) },
      {
        onSuccess: (res: DecideResponse) => {
          if (res.status === "invalid") {
            setDecisionError(INVALID_COPY[res.reason]);
          } else if (res.status === "already_decided") {
            setDecisionError(
              `This one's already been decided — ${res.item.decided_by_name ?? "someone"} handled it.`,
            );
          } else if (isTokenFailure(res)) {
            // The token died mid-session (e.g. revoked concurrently) — refetch
            // the list so the page's own token-failure screen takes over.
            void listQuery.refetch();
          }
        },
        onError: () => {
          setDecisionError("That didn't go through. Nothing was recorded — try again?");
        },
      },
    );
  }

  function beginDecision(itemId: string, decision: ReviewDecision, comment?: string) {
    setDecisionError(null);
    if (preview) {
      // Staff are looking at the client's screen. The controls are left
      // looking exactly as the client sees them — disabling them would make
      // this a different screen — so the action is caught here instead.
      setDecisionError(
        "Preview only — nothing was recorded. This is the screen the client sees.",
      );
      return;
    }
    if (approver) {
      fireDecision(itemId, decision, comment, approver);
    } else {
      setPendingDecision({ itemId, decision, comment });
    }
  }

  function sendReply(itemId: string, body: string) {
    setReplyError(null);
    if (preview) {
      // Same rule as the decision buttons: staff are looking at the client's
      // screen, so the control keeps its real appearance and the action is
      // caught here rather than disabled.
      setReplyError("Preview only — nothing was sent. This is the screen the client sees.");
      return;
    }
    replyMutation.mutate(
      { item_id: itemId, body },
      {
        onSuccess: (res) => {
          if (res.status === "invalid") {
            setReplyError(
              res.reason === "missing_comment"
                ? "Write something first."
                : "That item isn't on your list any more.",
            );
          } else if (isTokenFailure(res)) {
            void listQuery.refetch();
          }
        },
        onError: () => setReplyError("That didn't send. Try again?"),
      },
    );
  }

  function handleQuickApprove(id: string) {
    setDecisionError(null);
    setSelectedId(id);
    beginDecision(id, "approved");
  }

  // --- token failure -------------------------------------------------------
  if (data && isTokenFailure(data)) {
    const copy = TOKEN_FAILURE_COPY[data.status];
    return (
      <CenteredCard>
        <p className="text-title-small text-m-on-surface">{copy.title}</p>
        <p className="mt-2 text-body-medium text-m-on-surface-variant">{copy.body}</p>
        <p className="mt-2 text-body-medium text-m-on-surface-variant">— Converted Click</p>
        <Button asChild variant="outline" className="mt-4">
          <a href={`mailto:${REVIEW_REPLY_TO}`}>Email us</a>
        </Button>
      </CenteredCard>
    );
  }

  // --- network / 500 (the thrown path) -------------------------------------
  if (!data && listQuery.isError) {
    return (
      <CenteredCard>
        <p className="text-title-small text-m-on-surface">We couldn&apos;t load your list just now.</p>
        <p className="mt-2 text-body-medium text-m-on-surface-variant">
          Give it a moment and try again — nothing you&apos;ve already approved is affected.
        </p>
        <Button className="mt-4" onClick={() => void listQuery.refetch()}>
          Try again
        </Button>
        <p className="mt-3 text-label-small text-m-on-surface-variant">
          {errorMessage(listQuery.error)}
        </p>
      </CenteredCard>
    );
  }

  const asAt = ok ? formatAsAt(ok.as_at) : "";
  const detailNode = selectedItem ? (
    <ItemDetail
      item={selectedItem}
      // On a personal link the name is already in the page header, and
      // repeating it over every item reads as nagging. The picker path has no
      // header line, so it keeps showing it here.
      approverName={signedIn ? null : (approver?.name ?? null)}
      busy={decisionMutation.isPending && decisionMutation.variables?.item_id === selectedItem.id}
      error={decisionError}
      overdue={isOverdue(selectedItem)}
      onDecide={(decision, comment) => beginDecision(selectedItem.id, decision, comment)}
      onReply={(body) => sendReply(selectedItem.id, body)}
      replyBusy={replyMutation.isPending}
      replyError={replyError}
    />
  ) : null;

  return (
    <div className="flex h-screen flex-col bg-m-background">
      <header className="flex items-center justify-between gap-4 border-b border-m-outline-variant px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <div className="text-title-small text-m-on-surface">
            {ok ? ok.company_name : <Skeleton className="h-5 w-40" />}
          </div>
          {signedIn ? (
            <p className="truncate text-label-small text-m-on-surface-variant">
              Signed in as {signedIn.full_name}
            </p>
          ) : null}
        </div>
        {asAt ? <p className="text-label-small text-m-on-surface-variant">As at {asAt}</p> : null}
      </header>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="flex gap-2 overflow-x-auto border-b border-m-outline-variant p-3 lg:w-56 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:p-4">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBucket(b.id)}
              className={cn(
                "flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-label-large transition-colors",
                bucket === b.id
                  ? "bg-m-primary-container text-m-on-primary-container"
                  : "text-m-on-surface-variant hover:bg-m-surface-container",
              )}
            >
              <span>{b.label}</span>
              <span className="text-label-small">{counts[b.id]}</span>
            </button>
          ))}
        </aside>

        <div className="w-full overflow-y-auto lg:w-96 lg:shrink-0 lg:border-r lg:border-m-outline-variant">
          <div className="border-b border-m-outline-variant px-4 py-2">
            <p className="text-label-small text-m-on-surface-variant">
              {asAt ? `As at ${asAt}` : " "}
            </p>
          </div>

          {listQuery.isPending ? (
            <div className="flex flex-col gap-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
          ) : bucketItems.length === 0 ? (
            <div className="flex flex-col items-center gap-1 p-8 text-center">
              <p className="text-title-small text-m-on-surface">{EMPTY_BUCKET_COPY[bucket][0]}</p>
              <p className="text-body-medium text-m-on-surface-variant">
                {EMPTY_BUCKET_COPY[bucket][1]}
              </p>
            </div>
          ) : (
            bucketItems.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                busy={decisionMutation.isPending && decisionMutation.variables?.item_id === item.id}
                onSelect={handleSelect}
                onQuickApprove={handleQuickApprove}
              />
            ))
          )}
        </div>

        {/* Capped, not full-bleed. The pane is whatever is left of a monitor
            after the rail and the queue, which on a wide screen stretched the
            answer box and every message bubble across two feet of glass. 46rem
            keeps the ask, the textarea and the thread at a readable measure;
            the column itself still grows, so the content sits in it rather
            than being pinned to the edge. */}
        <main className="hidden min-w-0 flex-1 overflow-y-auto p-8 lg:block">
          <div className="w-full max-w-[46rem]">{detailNode}</div>
        </main>

        <Sheet
          open={!isDesktop && selectedItem !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
        >
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
            {selectedItem ? (
              <>
                <SheetTitle className="sr-only">{selectedItem.client_title}</SheetTitle>
                {detailNode}
              </>
            ) : null}
          </SheetContent>
        </Sheet>
      </div>

      <IdentityDialog
        open={pendingDecision !== null}
        contacts={ok?.contacts ?? []}
        onPick={(picked) => {
          setRemembered(picked);
          const pd = pendingDecision;
          setPendingDecision(null);
          if (pd) fireDecision(pd.itemId, pd.decision, pd.comment, picked);
        }}
        onCancel={() => setPendingDecision(null)}
      />
    </div>
  );
}
