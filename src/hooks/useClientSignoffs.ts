// src/hooks/useClientSignoffs.ts
//
// The staff side of the client sign-off inbox: what every client owes us, and
// a faithful preview of the page they see.
//
// The preview hook deliberately returns the SAME ListResponse shape the
// `client-review` edge function returns, so /client-signoffs can render the
// real <ClientReview> component tree rather than a staff-only lookalike. A
// second rendering would drift from what clients actually see, which is the
// one thing a preview must never do.
//
// Staff read these tables through RLS on their own session; the service-role
// edge function is only for the tokenless client. The column lists here mirror
// the function's on purpose — if one gains a field that must not reach a
// client, the other must not gain it either.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { courtOf } from "@/lib/client-waiting";
import type {
  ListResponse,
  ReviewContact,
  ReviewItem,
  ReviewOpen,
  ReviewScheduleRow,
} from "@/types/client-review";

/**
 * PostgREST returns a to-one embed as an object at runtime but types it as an
 * array. Accept both rather than casting the whole row through `unknown`.
 */
type BriefWait = {
  created_at: string | null;
  client_wait_ms: number | null;
  internal_wait_ms: number | null;
  clickup_task_status: string | null;
  completed_at: string | null;
};
function briefOf(briefs: BriefWait | BriefWait[] | null | undefined): BriefWait | null {
  if (!briefs) return null;
  return (Array.isArray(briefs) ? briefs[0] : briefs) ?? null;
}
/**
 * Both halves of the ClickUp clock, plus whose court the task is in — the
 * three wire fields the edge function derives the same way (courtOf is the
 * shared rule; the function mirrors it because Deno cannot import from src/).
 * The raw status is NOT among them: it is ClickUp's vocabulary, not a
 * client's.
 */
function clockOf(briefs: BriefWait | BriefWait[] | null | undefined) {
  const row = briefOf(briefs);
  // An UNSYNCED task has no court. courtOf reads "not a waiting status" as
  // ours, which is right for the staff tab and wrong here: it would quietly
  // move an ask the client genuinely owes us out of their "Your move" pane
  // just because ClickUp had not been read yet. No status, no opinion.
  const known = !!row && (!!row.clickup_task_status || !!row.completed_at);
  return {
    waiting_ms: row?.client_wait_ms ?? null,
    work_since: row?.created_at ?? null,
    our_ms: row?.internal_wait_ms ?? null,
    court: known ? courtOf(row!) : null,
  };
}

/**
 * The email that carried an ask. Two columns and no more: the addresses and
 * who composed it are on that table and neither belongs on a client's wire.
 */
type EmailSent = { sent_at: string | null; status: string | null };
function sentAtOf(emails: EmailSent | EmailSent[] | null | undefined): string | null {
  const row = (Array.isArray(emails) ? emails[0] : emails) ?? null;
  return row?.status === "sent" ? row.sent_at : null;
}

/** One row of the cross-client queue, for the aggregate table and rail counts. */
export type SignoffRow = ReviewItem & {
  client_id: string;
  client_name: string;
  created_at: string;
  /** Staff-side only. For an agreement of ours: the task it became. */
  brief_id: string | null;
};

// The brief embed is the ONE read from briefs, mirroring the edge function's
// rule 1 — see the header of supabase/functions/client-review. It carries the
// two clocks and what the status means, never the status text itself.
const ITEM_COLUMNS =
  "id, client_id, item_type, client_title, ask, detail, due_date, weighty, state, decided_at, decided_by_name, agreed_at, agreed_via, owed_by, raised_by, raised_by_name, created_at, client_note, links, briefs(created_at, client_wait_ms, internal_wait_ms, clickup_task_status, completed_at), outbound_emails(sent_at, status)";

/**
 * The evidence behind one decision (0142). Staff-only — none of it crosses to
 * the client, and decided_title/decided_ask are the FROZEN text, which is the
 * whole reason to read them rather than the live columns: they say what the
 * person actually agreed to, not what the item says today.
 */
export type SignoffEvidence = {
  decided_at: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
  decided_by_contact_id: string | null;
  decided_title: string | null;
  decided_ask: string | null;
  decided_ip: string | null;
  decided_user_agent: string | null;
  client_note: string | null;
  client_title: string;
  ask: string;
};

export function useSignoffEvidence(approvalId: string | undefined) {
  return useQuery({
    queryKey: ["signoff-evidence", approvalId ?? ""],
    enabled: !!approvalId,
    queryFn: async (): Promise<SignoffEvidence> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .select(
          "decided_at, decided_by_name, decided_by_email, decided_by_contact_id, decided_title, decided_ask, decided_ip, decided_user_agent, client_note, client_title, ask",
        )
        .eq("id", approvalId!)
        .single();
      if (error) throw new Error(errorMessage(error));
      return data as SignoffEvidence;
    },
  });
}

/**
 * Staff-only additions to the mirrored list above. brief_id is a Conductor id
 * with no meaning to a client and deliberately never enters ITEM_COLUMNS —
 * that constant's value is that it cannot quietly gain a field the edge
 * function does not also have.
 */
const STAFF_ONLY_COLUMNS = "brief_id";

/** Whole days an undecided item has been past its due date. 0 when not late. */
export function daysWaiting(row: SignoffRow): number {
  if (row.state !== "pending" || !row.due_date) return 0;
  const due = new Date(`${row.due_date}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

/**
 * Every sign-off across every client, newest first. Small by nature — one row
 * per thing a client was ever asked to decide — so it is fetched whole rather
 * than paged.
 */
export function useClientSignoffs() {
  return useQuery({
    queryKey: ["client-signoffs"],
    queryFn: async (): Promise<SignoffRow[]> => {
      const { data, error } = await supabase
        .from("client_approvals")
        .select(`${ITEM_COLUMNS}, ${STAFF_ONLY_COLUMNS}, clients!inner(name)`)
        .order("created_at", { ascending: false });
      if (error) throw new Error(errorMessage(error));

      return (data ?? []).map((r) => {
        const { clients, briefs, outbound_emails, links, ...rest } = r as typeof r & {
          clients: { name: string } | null;
          briefs: BriefWait | BriefWait[] | null;
          outbound_emails: EmailSent | EmailSent[] | null;
          links: string[] | null;
        };
        return {
          ...(rest as Omit<
            SignoffRow,
            | "client_name"
            | "waiting_ms"
            | "our_ms"
            | "court"
            | "work_since"
            | "links"
            | "emailed_at"
            | "moves"
          >),
          client_name: clients?.name ?? "Unknown client",
          links: links ?? [],
          emailed_at: sentAtOf(outbound_emails),
          // The cross-client table shows a row's state in a column; nobody
          // opens a history from it, so the moves are not fetched here.
          moves: [],
          ...clockOf(briefs),
        };
      });
    },
  });
}

/**
 * The client's own payload, rebuilt from a staff session. Mirrors the edge
 * function's `list` response field for field so the preview renders through
 * the same component tree the client gets.
 *
 * Never returns a token failure — staff reach this by client id, not by link,
 * so "is the link alive" is a separate question answered on the page itself.
 */
export function useClientReviewPreview(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-review-preview", clientId ?? ""],
    enabled: !!clientId,
    queryFn: async (): Promise<ListResponse> => {
      if (!clientId) throw new Error("No client selected");

      const [clientRes, contactRes, itemRes, threadRes, moveRes, openRes, scheduleRes] =
        await Promise.all([
          supabase.from("clients").select("name").eq("id", clientId).single(),
          supabase
            .from("contacts")
            .select("id, full_name")
            .eq("client_id", clientId)
            .not("full_name", "is", null)
            .order("full_name"),
          // Parked is EXCLUDED here, exactly as the edge function excludes it
          // (0148). The preview's whole job is to show what the client sees, and
          // an idea we have not raised with them appearing on it would be the
          // same class of leak as an internal note.
          supabase
            .from("client_approvals")
            .select(ITEM_COLUMNS)
            .eq("client_id", clientId)
            .neq("state", "parked")
            .order("created_at", { ascending: false }),
          // kind='note' EXCLUDED, exactly as the edge function excludes it. An
          // internal note appearing in the preview would be a staff-only leak in
          // the one place whose job is to show what the client sees.
          supabase
            .from("client_activity")
            .select("id, approval_id, kind, body, author_name, created_at")
            .eq("client_id", clientId)
            .in("kind", ["message", "client_message"])
            .order("created_at"),
          // The state moves behind the client's history panel — a SECOND query
          // rather than widening the thread's .in(...) to include 'status', so
          // this select names no author column at all and the staff member who
          // moved a state cannot reach the client even by accident.
          supabase
            .from("client_activity")
            .select("id, approval_id, from_state, to_state, created_at")
            .eq("client_id", clientId)
            .eq("kind", "status")
            .order("created_at"),
          // Who on their side has opened their link. Personal, unrevoked links
          // only: a shared one names nobody and a revoked one is not a way in.
          supabase
            .from("client_review_tokens")
            .select("last_used_at, contacts(full_name)")
            .eq("client_id", clientId)
            .not("contact_id", "is", null)
            .not("last_used_at", "is", null)
            .is("revoked_at", null),
          // The school's delivery plan, from the same view the edge function
          // reads (0159) — the preview's job is to show what the client sees,
          // and their calendar is most of what they see.
          supabase
            .from("client_pipeline_schedule")
            .select("id, label, side, month_no, theme, shows_on, completed_at")
            .eq("client_id", clientId)
            .order("shows_on"),
        ]);

      if (clientRes.error) throw new Error(errorMessage(clientRes.error));
      if (contactRes.error) throw new Error(errorMessage(contactRes.error));
      if (itemRes.error) throw new Error(errorMessage(itemRes.error));
      if (threadRes.error) throw new Error(errorMessage(threadRes.error));
      if (moveRes.error) throw new Error(errorMessage(moveRes.error));
      // Not fatal, as in the edge function: a history panel missing an open
      // still reads, and the queue behind it must not fail with it.
      if (openRes.error) console.error("[preview] opens:", openRes.error.message);
      // Not fatal, exactly as in the edge function: the plan is context beside
      // the asks, and a preview that cannot draw next month must still show
      // this month's queue.
      if (scheduleRes.error) console.error("[preview] schedule:", scheduleRes.error.message);

      // One row per person, newest open wins — the same contact can hold
      // several links (a fresh one is minted per question) and "when did she
      // last look" is one answer, not four.
      const latestOpen = new Map<string, string>();
      for (const row of openRes.data ?? []) {
        const contact = row as typeof row & {
          contacts: { full_name: string | null } | { full_name: string | null }[] | null;
        };
        const one =
          (Array.isArray(contact.contacts) ? contact.contacts[0] : contact.contacts) ?? null;
        const name = one?.full_name;
        const at = row.last_used_at;
        if (!name || !at) continue;
        const seen = latestOpen.get(name);
        if (!seen || at > seen) latestOpen.set(name, at);
      }
      const opens: ReviewOpen[] = [...latestOpen.entries()].map(([name, at]) => ({ name, at }));

      const contacts: ReviewContact[] = (contactRes.data ?? [])
        .filter((c): c is { id: string; full_name: string } => !!c.full_name)
        .map((c) => ({ id: c.id, full_name: c.full_name }));

      const items: ReviewItem[] = (itemRes.data ?? []).map((r) => ({
        id: r.id,
        item_type: r.item_type as ReviewItem["item_type"],
        client_title: r.client_title,
        ask: r.ask,
        detail: r.detail,
        due_date: r.due_date,
        weighty: r.weighty,
        state: r.state as ReviewItem["state"],
        decided_at: r.decided_at,
        decided_by_name: r.decided_by_name,
        agreed_at: r.agreed_at,
        agreed_via: r.agreed_via,
        owed_by: r.owed_by === "us" ? ("us" as const) : ("client" as const),
        raised_by: r.raised_by === "client" ? ("client" as const) : ("us" as const),
        raised_by_name: r.raised_by_name,
        created_at: r.created_at,
        client_note: r.client_note,
        links: r.links ?? [],
        emailed_at: sentAtOf(r.outbound_emails),
        // 'parked' is dropped HERE and not in the panel, exactly as the edge
        // function drops it: parked is a staff-only state (0148) and its name
        // must not reach the client's screen even as the from/to of a move.
        moves: (moveRes.data ?? [])
          .filter(
            (m) =>
              m.approval_id === r.id &&
              !!m.to_state &&
              m.from_state !== "parked" &&
              m.to_state !== "parked",
          )
          .map((m) => ({
            id: m.id,
            at: m.created_at,
            from: (m.from_state as ReviewItem["state"] | null) ?? null,
            to: m.to_state as ReviewItem["state"],
          })),
        ...clockOf(r.briefs),
        // The preview is a faithful render of the client's screen, so the
        // thread has to be on it too — see the thread query below.
        messages: (threadRes.data ?? [])
          .filter((m) => m.approval_id === r.id)
          .map((m) => ({
            id: m.id,
            from: m.kind === "client_message" ? ("them" as const) : ("us" as const),
            author: m.kind === "client_message" ? m.author_name : null,
            body: m.body ?? "",
            at: m.created_at,
          })),
      }));

      return {
        status: "ok",
        company_name: clientRes.data?.name ?? "Unknown client",
        as_at: new Date().toISOString(),
        contacts,
        opens,
        items,
        schedule: (scheduleRes.data ?? []) as ReviewScheduleRow[],
        // Staff reach the preview by client id, not by anyone's link, so there
        // is nobody to be signed in as. The preview therefore shows the
        // company-wide shape — which is the honest thing: it cannot know which
        // person's link a given client will open.
        signed_in_as: null,
      };
    },
  });
}

/**
 * Every school's delivery plan, across every client — the staff side of the
 * same view the client's page reads (0159). Small by nature: twelve months of
 * one template per live school year.
 *
 * A separate hook rather than a column on useClientSignoffs, because it is a
 * different table and only one tab wants it. It carries client_id so the
 * all-clients calendar can name the school; the name itself is resolved from
 * the client list the page already has, rather than an embed the view would
 * have to keep answering for.
 */
export function usePipelineSchedule() {
  return useQuery({
    queryKey: ["pipeline-schedule"],
    queryFn: async (): Promise<(ReviewScheduleRow & { client_id: string })[]> => {
      const { data, error } = await supabase
        .from("client_pipeline_schedule")
        .select("id, label, side, month_no, theme, shows_on, completed_at, client_id")
        .order("shows_on");
      if (error) throw new Error(errorMessage(error));
      return (data ?? []) as (ReviewScheduleRow & { client_id: string })[];
    },
  });
}

/** Live (unrevoked) link count per client, so staff can see who can't get in. */
export function useLiveLinkCounts() {
  return useQuery({
    queryKey: ["client-review-link-counts"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("client_review_tokens")
        .select("client_id")
        .is("revoked_at", null);
      if (error) throw new Error(errorMessage(error));
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
      return counts;
    },
  });
}
