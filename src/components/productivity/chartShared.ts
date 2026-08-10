// Shared bits for the Recharts-based productivity charts: tooltip styling
// and the "which members get a bar, in what colour" logic that was
// previously copy-pasted across DeliveryRateChart / DeliveryValueChart /
// DeliverySpeedChart / HoursTrackedChart / SprintPointsChart / TaskBreakdownTab.
//
// Tooltip colours are literal hex, not `m-` design tokens: Recharts renders
// these as inline styles regardless of the app's light/dark theme, and the
// chart card itself is always a dark chip by design (see the surrounding
// `bg-m-surface-container` panels, which DO follow the theme). Swapping to
// e.g. `var(--mcolor-surface-container-high)` would make the tooltip go
// near-white with light (#e2e8f0) text in light mode — illegible — so the
// colour stays hardcoded, just de-duplicated into one place.
export const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;

export const TOOLTIP_STYLE_BORDERED = {
  background: "#1e2433",
  border: "1px solid #2d3748",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;

export const TOOLTIP_LABEL_STYLE = { color: "#e2e8f0", marginBottom: 4 } as const;
export const TOOLTIP_ITEM_STYLE = { color: "#94a3b8", fontFamily: "var(--font-mono)" } as const;

import { memberColors, type TeamMember } from "@/hooks/useTeam";

/** A team member linked to ClickUp — the only ones with time-tracked data to chart. */
export type LinkedMember = TeamMember & { clickup_user_id: number };

export function membersWithClickUp(members: TeamMember[]): LinkedMember[] {
  return members.filter((m): m is LinkedMember => m.clickup_user_id !== null);
}

/** ClickUp-linked members, narrowed to the selected person (or everyone when nothing is selected). */
export function visibleMembers(members: TeamMember[], selectedUserId: number | null): LinkedMember[] {
  const linked = membersWithClickUp(members);
  return selectedUserId ? linked.filter((m) => m.clickup_user_id === selectedUserId) : linked;
}

/**
 * One stable colour per person, keyed by clickup_user_id (how chart series
 * are keyed). Built from the same app-wide face-colour rule TeamSidebar uses
 * (see `memberColors` in useTeam — position in the full, name-ordered team
 * list) so a person's colour matches across every chart and the Team rail,
 * instead of each chart assigning colour by position among only its
 * ClickUp-linked members.
 */
export function memberColorMap(members: TeamMember[]): Record<number, string> {
  const byId = memberColors(members);
  const map: Record<number, string> = {};
  for (const m of membersWithClickUp(members)) {
    map[m.clickup_user_id] = byId.get(m.id) ?? "#7C3AED";
  }
  return map;
}
