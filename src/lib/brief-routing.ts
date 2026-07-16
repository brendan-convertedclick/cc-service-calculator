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
  briefed: "Briefed",
};

export type BillingType = "retainer" | "adhoc";

export const BILLING_LABEL: Record<BillingType, string> = {
  retainer: "Retainer",
  adhoc: "Adhoc",
};

export function resumeHref(b: Brief): string {
  // The staged brief page carries the whole journey now — In/Out of Scope,
  // The Brief, Scope Edit, Cost Estimate, Approve & Schedule — and opens on
  // the first actionable stage for the brief's state. Every status resumes
  // there; the scope map (/sow-check) and quote builder (/builder) remain
  // reachable from within the flow for the quote path.
  return `/briefs/${b.id}/scope`;
}
