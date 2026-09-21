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
  const byStream = new Map<string, ClickUpListOption[]>();
  const other: ClickUpListOption[] = [];

  for (const l of lists) {
    const stream = l.work_stream ?? null;
    // An unknown stream name is treated as no stream: better in "Other lists"
    // than inventing a heading nobody chose.
    if (stream && (WORK_STREAM_ORDER as readonly string[]).includes(stream)) {
      const bucket = byStream.get(stream) ?? [];
      bucket.push(l);
      byStream.set(stream, bucket);
    } else {
      other.push(l);
    }
  }

  const groups: ListGroup[] = [];
  for (const stream of WORK_STREAM_ORDER) {
    const options = byStream.get(stream);
    if (options?.length) {
      groups.push({ label: stream, options: [...options].sort(byName) });
    }
  }
  if (other.length) groups.push({ label: OTHER_GROUP, options: [...other].sort(byName) });
  return groups;
}

function byName(a: ClickUpListOption, b: ClickUpListOption) {
  return a.name.localeCompare(b.name);
}
