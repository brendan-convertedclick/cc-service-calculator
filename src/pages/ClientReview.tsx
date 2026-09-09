import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Hand,
  Hourglass,
  List,
  MessageCircleQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ItemDetail } from "@/components/review/ItemDetail";
import { ItemActivity } from "@/components/review/ItemActivity";
import { IdentityDialog } from "@/components/review/IdentityDialog";
import { QueueRow } from "@/components/review/QueueRow";
import { WorkDetail, WorkRow } from "@/components/review/WorkRow";
import { MonthCalendar } from "@/components/review/MonthCalendar";
import { HoldingView } from "@/components/review/HoldingView";
import { RaiseDialog } from "@/components/review/RaiseDialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  useRememberedApprover,
  useReviewDecision,
  useReviewList,
  useReviewRaise,
  useReviewReply,
} from "@/hooks/useClientReview";
import { useClientReviewPreview } from "@/hooks/useClientSignoffs";
import {
  bucketCounts,
  bucketOf,
  calendarEntriesFor,
  formatAsAt,
  isOverdue,
  queueFor,
  REVIEW_REPLY_TO,
  sortForQueue,
} from "@/lib/client-review";
import { currentMonth } from "@/lib/calendar-month";
import { cn, errorMessage } from "@/lib/utils";
import {
  isTokenFailure,
  type DecideResponse,
  type RememberedApprover,
  type RaiseKind,
  type ReviewBucket,
  type ReviewDecision,
  type ReviewIdentity,
  type TokenFailure,
} from "@/types/client-review";

const BUCKETS: { id: ReviewBucket; label: string; Icon: typeof Hand }[] = [
  // The icon says whose move it is before the words do: a hand held out, a
  // clock running on our side, a tick, a date.
  { id: "your-move", label: "Your move", Icon: Hand },
  { id: "with-us", label: "With us", Icon: Hourglass },
  { id: "signed-off", label: "Signed off", Icon: CheckCircle2 },
  // Dates they told us about. Last, because nothing here needs doing — it is
  // the pane you look at, not the one you work through.
  { id: "coming-up", label: "Coming up", Icon: CalendarDays },
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
  "coming-up": [
    "No dates on the calendar yet.",
    "Add anything happening on your side — a launch, a sale, time out of office — and we'll plan around it.",
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

const RAISE_INVALID_COPY = {
  missing_title: "Give it a short name first.",
  missing_body: "Write your question first.",
  missing_date: "Pick the date it happens.",
} as const;

const INVALID_COPY = {
  missing_comment: "Add a note so we know what to change.",
  unknown_contact: "We couldn't match that name — pick again?",
  unknown_item: "That item isn't on your list any more.",
  not_yours: "That one's with us — there's nothing for you to decide on it.",
} as const;

function approverToIdentity(approver: RememberedApprover): ReviewIdentity {
  return approver.contact_id
    ? { contact_id: approver.contact_id }
    : { name: approver.name, email: approver.email ?? undefined };
}

/** The rendered width of one element. ResizeObserver rather than the viewport,
 *  because this page is also rendered inside a staff preview card. */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
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
  const raiseMutation = useReviewRaise(token);
  const [remembered, setRemembered] = useRememberedApprover(token);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // Wide enough for the activity to sit BESIDE the item rather than under it.
  // Measured on the CONTAINER, not the viewport: on /client-signoffs this same
  // page is rendered inside a preview card roughly half a monitor wide, and a
  // viewport test there put a 24rem activity column next to the rail and the
  // queue and left the item itself about a word wide. It is also the more
  // honest preview — staff see what a client with a window that size gets.
  const [rootRef, rootWidth] = useContainerWidth<HTMLDivElement>();
  const isWide = rootWidth >= 1400;

  const [bucket, setBucket] = useState<ReviewBucket>("your-move");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{
    itemId: string;
    decision: ReviewDecision;
    comment?: string;
  } | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  // The month view. A toggle rather than a fourth column: on a phone the
  // queue and a calendar cannot both be on screen, and a calendar is
  // something you go and look at, not something you work beside.
  const [view, setView] = useState<"list" | "holding" | "calendar">("list");
  const [month, setMonth] = useState(currentMonth);
  const [raiseKind, setRaiseKind] = useState<RaiseKind | null>(null);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  // The one draft, owned here because two columns need it: the box is in
  // the chat and "Request changes" is on the item. Still one box on screen
  // — the page just knows what is in it.
  const [draft, setDraft] = useState("");

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
  // Briefed work that never became an ask. It rides beside `items` and never
  // inside them — see WorkRow: with no client_approvals row behind it there is
  // nothing an Approve could record and nothing a reply could hang off.
  const work = ok?.work ?? [];
  const counts = bucketCounts(items, work);
  // Asks and tasks in ONE order, on the one key both have. Appending the
  // tasks would put three 26-day-late ones under a 6-day ask, in a list whose
  // whole promise is "what needs you most, first".
  const queue = queueFor(items, work, bucket);
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const selectedWork = work.find((w) => w.id === selectedId) ?? null;
  const selectedItemId = selectedItem?.id ?? null;

  // What goes on the month view: their asks, their dates, and — for a school —
  // the delivery plan for the months either side of this one. Settled work is
  // ON it now, sitting on the day it was finished rather than the day it was
  // due, which is what makes paging back a month worth doing (0159). One pure
  // function, shared with the staff preview, so the two cannot disagree.
  const calendarEntries = calendarEntriesFor(items, ok?.schedule ?? []);

  // Auto-open the first item in "Your move" the moment the list first
  // loads — once only, so a decision later on never yanks the client away
  // from the item they just acted on (that item simply leaves the bucket
  // filter; selection is untouched until the client picks something else).
  // Report the selection outward whenever it moves. An effect rather than a
  // call inside each setSelectedId, so the auto-open on first load is reported
  // too — that is the item staff will be looking at.
  // Only a real ask is reported outward. A briefed task's id is a briefs.id,
  // and handing it to the staff ActivityPanel would have it query a timeline
  // for an approval that does not exist and offer an Edit on nothing.
  useEffect(() => {
    onSelectedItemChange?.(selectedItemId);
  }, [selectedItemId, onSelectedItemChange]);

  // A half-typed reply must not follow the reader onto the next item and get
  // sent against the wrong one.
  useEffect(() => {
    setDraft("");
  }, [selectedId]);

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
    const nextQueue = queueFor(items, work, next);
    setSelectedId(isDesktop ? (nextQueue[0]?.id ?? null) : null);
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
      setDecisionError("Preview only — nothing was recorded. This is the screen the client sees.");
      return;
    }
    if (comment !== undefined) setDraft("");
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
    setDraft("");
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

  function submitRaise(input: { kind: RaiseKind; title: string; body?: string; date?: string }) {
    setRaiseError(null);
    if (preview) {
      // Same rule as the decision and reply controls: staff are looking at the
      // client's screen, so it keeps its real appearance and the action is
      // caught here rather than disabled.
      setRaiseError("Preview only — nothing was sent. This is the screen the client sees.");
      return;
    }
    raiseMutation.mutate(input, {
      onSuccess: (res) => {
        if (res.status === "ok") {
          setRaiseKind(null);
          // Land them on what they just created rather than leaving them where
          // they were wondering whether it worked.
          setView("list");
          setBucket(input.kind === "event" ? "coming-up" : "with-us");
          setSelectedId(isDesktop ? res.item.id : null);
        } else if (res.status === "invalid") {
          setRaiseError(RAISE_INVALID_COPY[res.reason]);
        } else if (isTokenFailure(res)) {
          void listQuery.refetch();
        }
      },
      onError: () => setRaiseError("That didn't send. Nothing was recorded — try again?"),
    });
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
        <p className="text-title-small text-m-on-surface">
          We couldn&apos;t load your list just now.
        </p>
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
  // The server's own stamp, so every day-count on this page agrees with the
  // "As at" beside it rather than drifting with the tab being left open.
  const nowMs = ok?.as_at ? Date.parse(ok.as_at) : Date.now();
  const detailNode = selectedWork ? (
    <WorkDetail work={selectedWork} />
  ) : selectedItem ? (
    <ItemDetail
      item={selectedItem}
      // On a personal link the name is already in the page header, and
      // repeating it over every item reads as nagging. The picker path has no
      // header line, so it keeps showing it here.
      approverName={signedIn ? null : (approver?.name ?? null)}
      busy={decisionMutation.isPending && decisionMutation.variables?.item_id === selectedItem.id}
      error={decisionError}
      overdue={isOverdue(selectedItem)}
      draft={draft}
      onDecide={(decision, comment) => beginDecision(selectedItem.id, decision, comment)}
    />
  ) : null;
  // The activity, which is its own column on a wide screen and sits under the
  // item everywhere else. One instance either way — the media query picks
  // where it mounts, so the draft and the scroll position are never duplicated.
  const chatNode = selectedItem ? (
    <ItemActivity
      key={selectedItem.id}
      item={selectedItem}
      opens={ok?.opens ?? []}
      draft={draft}
      onDraftChange={setDraft}
      decideBusy={
        decisionMutation.isPending && decisionMutation.variables?.item_id === selectedItem.id
      }
      replyBusy={replyMutation.isPending}
      error={replyError}
      onDecide={(decision, comment) => beginDecision(selectedItem.id, decision, comment)}
      onReply={(body) => sendReply(selectedItem.id, body)}
    />
  ) : null;

  // max-h-full so the staff preview's 720px box wins. h-screen on its own made
  // this root taller than the card that clips it, so the bottom of the queue
  // sat somewhere nobody could scroll to — the column's own overflow-y-auto
  // never engaged, because the column was never the thing running out of room.
  // On the client's own route the parent height is indefinite and it no-ops.
  return (
    <div ref={rootRef} className="flex h-screen max-h-full flex-col bg-m-background">
      <header className="flex items-center justify-between gap-4 border-b border-m-outline-variant px-4 py-3 lg:px-6">
        <div className="min-w-0">
          {/* Their name, and it is the page's title — small enough to read as
              a label made the whole header look like a toolbar. */}
          <div className="text-title-large text-m-on-surface">
            {ok ? ok.company_name : <Skeleton className="h-7 w-40" />}
          </div>
          {signedIn ? (
            <p className="truncate text-label-small text-m-on-surface-variant">
              Signed in as {signedIn.full_name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-full border border-m-outline-variant p-0.5">
            {[
              { id: "list" as const, label: "List", Icon: List },
              // Their own copy of the tab staff argue from. Same figures, same
              // stop-clock rule — the two must never tell different stories
              // about the same week.
              { id: "holding" as const, label: "Who's holding it up", Icon: Hourglass },
              { id: "calendar" as const, label: "Calendar", Icon: CalendarDays },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-label-large transition-colors",
                  view === id
                    ? "bg-m-primary-container text-m-on-primary-container"
                    : "text-m-on-surface-variant hover:bg-m-surface-container",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === "holding" ? (
        <div className="flex-1 overflow-y-auto p-2 lg:p-4">
          <HoldingView items={items} work={ok?.work ?? []} now={nowMs} />
        </div>
      ) : view === "calendar" ? (
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <MonthCalendar
            month={month}
            entries={calendarEntries}
            onMonthChange={setMonth}
            emptyNote="Nothing on this month. Use the arrows to look back at what was done, or ahead at what is coming."
            onPick={(entry) => {
              // Back to the list, on the thing they clicked. A calendar that
              // cannot be clicked through to the detail is a picture.
              const item = items.find((i) => i.id === entry.id);
              if (!item) return;
              setView("list");
              setBucket(bucketOf(item));
              setSelectedId(item.id);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          <aside className="flex gap-2 overflow-x-auto border-b border-m-outline-variant p-3 lg:w-48 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
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
                <span className="flex items-center gap-2">
                  <b.Icon className="h-4 w-4 shrink-0" />
                  {b.label}
                </span>
                <span className="text-label-small">{counts[b.id]}</span>
              </button>
            ))}

            {/* Theirs to start, not just to answer. Down here with the rest of
                the navigation rather than up in the header: a question and a
                date are two more ways INTO this list, and the choice belongs
                before the typing, not after it. */}
            <div className="flex shrink-0 gap-2 lg:mt-4 lg:flex-col lg:border-t lg:border-m-outline-variant lg:pt-4">
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => setRaiseKind("question")}
              >
                <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                Ask us something
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => setRaiseKind("event")}
              >
                <CalendarPlus className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                Add a date
              </Button>
            </div>
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
            ) : queue.length === 0 ? (
              <div className="flex flex-col items-center gap-1 p-8 text-center">
                <p className="text-title-small text-m-on-surface">{EMPTY_BUCKET_COPY[bucket][0]}</p>
                <p className="text-body-medium text-m-on-surface-variant">
                  {EMPTY_BUCKET_COPY[bucket][1]}
                </p>
              </div>
            ) : (
              queue.map((entry) =>
                entry.kind === "item" ? (
                  <QueueRow
                    key={entry.id}
                    item={entry.item}
                    selected={entry.id === selectedId}
                    busy={
                      decisionMutation.isPending &&
                      decisionMutation.variables?.item_id === entry.id
                    }
                    onSelect={handleSelect}
                    onQuickApprove={handleQuickApprove}
                  />
                ) : (
                  <WorkRow
                    key={entry.id}
                    work={entry.work}
                    selected={entry.id === selectedId}
                    onSelect={handleSelect}
                  />
                ),
              )
            )}
          </div>

          {/* Capped, not full-bleed. The pane is whatever is left of a monitor
            after the rail and the queue, which on a wide screen stretched the
            answer box and every message bubble across two feet of glass. 46rem
            keeps the ask, the textarea and the thread at a readable measure;
            the column itself still grows, so the content sits in it rather
            than being pinned to the edge. */}
          <main className="hidden min-w-0 flex-1 overflow-y-auto p-8 lg:block">
            <div className="flex w-full max-w-[46rem] flex-col gap-8">
              {detailNode}
              {isDesktop && !isWide ? chatNode : null}
            </div>
          </main>

          {/* The activity, beside the item rather than under it. Fixed width
              and its own scroll: it grows all day and the item it is about
              must not slide off the top of the screen while it does. */}
          {/* `chatNode` and not `isWide` alone: a briefed task has no thread
              (nothing to hang one off), and an empty bordered column beside it
              reads as something that failed to load. */}
          {isWide && chatNode ? (
            <aside className="flex w-[24rem] shrink-0 flex-col border-l border-m-outline-variant p-4">
              {chatNode}
            </aside>
          ) : null}

          {/* A briefed task opens here too. Tapping a row that did nothing on
              a phone is how the list stops being trusted. */}
          <Sheet
            open={!isDesktop && (selectedItem !== null || selectedWork !== null)}
            onOpenChange={(open) => {
              if (!open) setSelectedId(null);
            }}
          >
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
              {selectedItem || selectedWork ? (
                <>
                  <SheetTitle className="sr-only">
                    {selectedItem?.client_title ?? selectedWork?.title ?? ""}
                  </SheetTitle>
                  {detailNode}
                  {chatNode}
                </>
              ) : null}
            </SheetContent>
          </Sheet>
        </div>
      )}

      <RaiseDialog
        open={raiseKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRaiseKind(null);
            setRaiseError(null);
          }
        }}
        initialKind={raiseKind ?? "question"}
        busy={raiseMutation.isPending}
        error={raiseError}
        onSubmit={submitRaise}
      />

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

/**
 * The same page on its own URL, for putting on a screen in a meeting: no nav
 * rail, no other client's name anywhere. It renders the staff preview, so it
 * is read-only by construction — pressing a button records nothing, and the
 * client still decides from their own link.
 */
export function ClientPresent() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  return <ClientReview previewClientId={clientId} />;
}
