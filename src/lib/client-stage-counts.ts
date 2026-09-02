// src/lib/client-stage-counts.ts
//
// How much is sitting on one client's sign-off page, for the reminder block in
// the emails we send them.
//
// THE BUCKETS ARE NOT REDEFINED HERE. They are the three the client already
// sees when they arrive, and the "how long has this been sitting" figure is
// `pressureDays` from client-review.ts — the same function the queue sorts by.
// A second definition would let the email and the page disagree about the same
// client in the same minute, which is the fastest way to make both untrusted.

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { pressureDays } from "@/lib/client-review";
import type { StageCounts } from "@/lib/client-email";
import type { ReviewItem } from "@/types/client-review";

/** The fields pressureDays reads. Everything else is padded to satisfy the type. */
type CountRow = {
  state: string;
  owed_by: string;
  due_date: string | null;
  briefs: { client_wait_ms: number | null } | { client_wait_ms: number | null }[] | null;
};

function waitingMsOf(briefs: CountRow["briefs"]): number | null {
  if (!briefs) return null;
  const row = Array.isArray(briefs) ? briefs[0] : briefs;
  return row?.client_wait_ms ?? null;
}

/** Derivation only — pure, so the bucket rules can be tested without a database. */
export function countStages(rows: CountRow[]): StageCounts {
  let waitingOnYou = 0;
  let withUs = 0;
  let signedOff = 0;
  let oldestDays = 0;

  for (const row of rows) {
    // Parked is on the list but has no clock (0148): it is not waiting on
    // them, not with us, and not signed off. Counting it as any of those would
    // put a number in a chase email that nobody is acting on — and it is
    // staff-only, so a client counting three items would only find two.
    if (row.state === "parked") continue;
    // An event (0149) is a date nobody acts on — it belongs on the calendar,
    // not in a count of who owes what. Without this it would fall through to
    // waitingOnYou and chase a client about their own launch date.
    if (row.state === "noted") continue;
    if (row.state === "approved") {
      signedOff += 1;
      continue;
    }
    // Back with us after they answered, or something we ourselves promised.
    if (row.state === "changes_requested" || row.owed_by === "us") {
      withUs += 1;
      continue;
    }
    waitingOnYou += 1;

    const item = {
      state: row.state,
      owed_by: row.owed_by,
      due_date: row.due_date,
      waiting_ms: waitingMsOf(row.briefs),
    } as ReviewItem;
    oldestDays = Math.max(oldestDays, pressureDays(item));
  }

  return { waitingOnYou, withUs, signedOff, oldestDays };
}

/**
 * One query per send. Cheap — a client has tens of these rows, not thousands —
 * and both call sites already hold the client id.
 *
 * Never throws: a counting failure must not stop a question or a chase going
 * out. Null means "no block", which the template already treats as silence.
 */
export async function fetchStageCounts(clientId: string): Promise<StageCounts | null> {
  try {
    const { data, error } = await supabase
      .from("client_approvals")
      .select("state, owed_by, due_date, briefs(client_wait_ms)")
      .eq("client_id", clientId)
      .neq("state", "parked");
    if (error) {
      console.warn("[stage-counts]", errorMessage(error));
      return null;
    }
    return countStages((data ?? []) as unknown as CountRow[]);
  } catch (e) {
    console.warn("[stage-counts]", errorMessage(e));
    return null;
  }
}
