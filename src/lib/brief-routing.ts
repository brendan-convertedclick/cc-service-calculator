import type { Database } from "@/types/db";

export type Brief = Database["public"]["Tables"]["briefs"]["Row"];
export type BriefStatus = Database["public"]["Enums"]["brief_status"];

export const STATUS_LABEL: Record<BriefStatus, string> = {
  new: "New",
  needs_info: "Awaiting client",
  triaged: "Scoping",
  scoped: "Building",
  quoted: "Quoted",
  accepted: "Accepted",
  rejected: "Rejected",
  archived: "Archived",
  spam: "Spam",
};

export function resumeHref(b: Brief): string {
  switch (b.status) {
    case "triaged":
      return `/briefs/${b.id}/scope`;
    case "scoped":
    case "quoted":
    case "accepted":
      return `/briefs/${b.id}/builder`;
    default:
      return `/briefs/${b.id}/scope`;
  }
}
