// Grouping the "List" dropdown by work stream (Lisa, 2026-09-21: "these should
// all be the same and maybe some have 1/2 more but nothing random").
//
// The randomness is real but it is ClickUp's, not Conductor's: 196 lists across
// 29 clients, of which 168 already answer to one of the eight work streams once
// the aliases are applied. The rest are genuine project lists — four Ultimate
// Guides, four Pimms dashboards, campaign plans — which have every right to
// exist and no business being in a dropdown that means "what kind of work is
// this".
//
// So nothing is renamed and nothing is hidden. The list the user picks is still
// the real ClickUp list, under its real name, because that is the name they
// will go looking for in ClickUp and it is what gets written to
// `briefs.clickup_list_name`. Only the ORDER and the headings change: the eight
// streams first in a fixed order, everything else under "Other lists".
//
// The order is deliberately not alphabetical. Alphabetical is a random order to
// a human; this one runs roughly in the sequence work happens.
export const WORK_STREAM_ORDER = [
  "Admin",
  "Strategy",
  "Content",
  "Creative",
  "Development",
  "SEO",
  "Paid Media",
  "Social Media",
] as const;

// The newer client template uses a second set of lists that are not work
// streams at all: they answer "is this billable", which is the `task_groups`
// taxonomy, not "what kind of work is this". Conflating the two in
// `list_aliases` would corrupt the mapping the task-creating edge functions
// read, so they are matched here on the list name instead, and given their own
// headings AFTER the work streams (Lisa, 2026-09-21 — leaving them in "Other
// lists" beside a one-off campaign plan made the dropdown look broken, and on
// Kings College it buried three of its lists).
//
// ClickUp has both "Overhead" and "Non-Billable" in the wild for the same
// thing; task_groups calls that group Non-Billable, so that is the heading.
export const STANDING_GROUP_ORDER = ["Delivery", "Meetings", "Non-Billable"] as const;

const STANDING_BY_NAME = new Map<string, string>([
  ["delivery", "Delivery"],
  ["meetings", "Meetings"],
  ["meeting", "Meetings"],
  ["non-billable", "Non-Billable"],
  ["non billable", "Non-Billable"],
  ["overhead", "Non-Billable"],
]);

export const OTHER_GROUP = "Other lists";

/** A list as `list-client-clickup-lists` returns it. `work_stream` is resolved
 *  server-side from list_aliases + list_alias_overrides, and is null for the
 *  project and campaign lists that answer to no stream. */
export interface ClickUpListOption {
  id: string;
  name: string;
  work_stream?: string | null;
}

export interface ListGroup {
  label: string;
  options: ClickUpListOption[];
}

/**
 * Group lists by work stream, streams first in WORK_STREAM_ORDER and the rest
 * under "Other lists" alphabetically. Empty groups are dropped, so a client
 * with five lists shows five, not eight headings and three blanks.
 *
 * A stream holding more than one list is left alone rather than collapsed:
 * Trellidor really does have both "Admin" and "Administration", and which one
 * wins is a decision for a `list_alias_overrides` row, not for this function
 * to make silently.
 */
export function groupListsByWorkStream(lists: ClickUpListOption[]): ListGroup[] {
  const byGroup = new Map<string, ClickUpListOption[]>();
  const other: ClickUpListOption[] = [];
  const put = (label: string, l: ClickUpListOption) => {
    const bucket = byGroup.get(label) ?? [];
    bucket.push(l);
    byGroup.set(label, bucket);
  };

  for (const l of lists) {
    const stream = l.work_stream ?? null;
    // An unknown stream name is treated as no stream: better in "Other lists"
    // than inventing a heading nobody chose.
    if (stream && (WORK_STREAM_ORDER as readonly string[]).includes(stream)) {
      put(stream, l);
      continue;
    }
    // A work stream always wins: a list is only a standing category when it
    // answered to no stream, so this can never pull SEO out of SEO.
    const standing = STANDING_BY_NAME.get(l.name.trim().toLowerCase());
    if (standing) put(standing, l);
    else other.push(l);
  }

  const groups: ListGroup[] = [];
  for (const label of [...WORK_STREAM_ORDER, ...STANDING_GROUP_ORDER]) {
    const options = byGroup.get(label);
    if (options?.length) {
      groups.push({ label, options: [...options].sort(byName) });
    }
  }
  if (other.length) groups.push({ label: OTHER_GROUP, options: [...other].sort(byName) });
  return groups;
}

function byName(a: ClickUpListOption, b: ClickUpListOption) {
  return a.name.localeCompare(b.name);
}
