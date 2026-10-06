import { useQuery } from "@tanstack/react-query";
import { callEdgeFn } from "@/lib/edge";

export type ClickUpListStatus = { status: string; color: string | null; type: string; orderindex: number };
export type ClickUpListOption = {
  id: string;
  name: string;
  /** Resolved server-side from list_aliases; groups the dropdown. */
  work_stream?: string | null;
  statuses: ClickUpListStatus[];
};
export type WorkStreamOption = { id: string; name: string };

/**
 * A client's ClickUp lists (with their statuses) and ClickUp's real Work Stream
 * options, from `list-client-clickup-lists`. Pass null to stay idle, so a
 * closed sheet makes no network call.
 */
export function useClientClickUpLists(clientId: string | null) {
  return useQuery({
    queryKey: ["client-clickup-lists", clientId],
    enabled: clientId != null,
    queryFn: () =>
      callEdgeFn<{ lists?: ClickUpListOption[]; work_stream_options?: WorkStreamOption[] }>(
        "list-client-clickup-lists",
        { client_id: clientId },
      ),
  });
}

/** The "projects" list, mirroring the server's own fallback, else the first. */
export function defaultListId(lists: ClickUpListOption[]): string {
  return (lists.find((l) => /project/i.test(l.name)) ?? lists[0])?.id ?? "";
}
