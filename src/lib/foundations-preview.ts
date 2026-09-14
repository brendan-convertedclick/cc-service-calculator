// What an Apply run on /scaffold/foundations is about to do, worked out before
// anyone presses the button.
//
// A baseline creates a ClickUp list only when its task group has none mapped
// for that client. Kings College already had lists called Admin, Creative and
// Development mapped to Administration, Delivery and Non-Billable, so a correct
// run reported "0 lists created" and read as a failure. The page now says which
// list each baseline lands on.
//
// Keys are `${client_id}|${group_id}`, matching the client_lists rows.

export type BaselineOutcome = { text: string; creates: boolean };

export function outcomeFor(
  groupId: string | null | undefined,
  clientIds: string[],
  existing: Map<string, string>,
): BaselineOutcome | null {
  if (!groupId || clientIds.length === 0) return null;
  const names = clientIds
    .map((cid) => existing.get(`${cid}|${groupId}`))
    .filter((n): n is string => !!n);
  if (names.length === 0) return { text: "will create", creates: true };
  // One client is the common case and the only one where naming the list is
  // unambiguous; past that a count is the honest answer.
  if (clientIds.length === 1) return { text: `maps to ${names[0]}`, creates: false };
  if (names.length === clientIds.length) return { text: "all mapped already", creates: false };
  return { text: `${names.length} of ${clientIds.length} mapped`, creates: true };
}

/** [lists this run will create, cells that already have one] across every
 *  client × baseline pair. */
export function countListWork(
  clientIds: string[],
  groupIds: Array<string | null | undefined>,
  existing: Map<string, string>,
): [create: number, mapped: number] {
  let create = 0;
  let mapped = 0;
  for (const cid of clientIds) {
    for (const gid of groupIds) {
      if (!gid) continue;
      if (existing.has(`${cid}|${gid}`)) mapped++;
      else create++;
    }
  }
  return [create, mapped];
}
