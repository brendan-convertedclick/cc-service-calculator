/**
 * Shared formatting + scope-status styling for the dashboard overview views
 * (Bento grid and Status board). Keeps the two layouts visually consistent.
 */

import { CheckCircle, TriangleAlert, CircleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const zarFormat = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

/** Format integer cents as `R 1 980` (en-ZA, no decimals). */
export function fmtZAR(cents: number): string {
  return zarFormat.format(cents / 100);
}

/** scope_status → status-dot colour class. */
export const scopeDot: Record<string, string> = {
  on_track: "bg-m-tertiary",
  needs_attention: "bg-amber-400",
  overdue: "bg-m-error",
};

/** scope_status → status icon + colour class (mirrors the project rail). */
export const scopeIcon: Record<string, { icon: LucideIcon; color: string }> = {
  on_track: { icon: CheckCircle, color: "text-m-tertiary" },
  needs_attention: { icon: TriangleAlert, color: "text-amber-500" },
  overdue: { icon: CircleAlert, color: "text-m-error" },
};

/** scope_status → pill badge colour classes. */
export const scopeBadge: Record<string, string> = {
  on_track: "bg-m-tertiary-container text-m-on-tertiary-container",
  needs_attention: "bg-amber-100 text-amber-800",
  overdue: "bg-m-error-container text-m-on-error-container",
};

/** scope_status → human label. */
export const scopeLabel: Record<string, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  overdue: "Overdue",
};

/** Xero RAG → dot colour class (matches the existing margin table). */
export const ragDot: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
};
