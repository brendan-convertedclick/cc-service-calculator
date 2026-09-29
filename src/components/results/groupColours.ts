// src/components/results/groupColours.ts
//
// The single sanctioned place for the eight results-group colours (see
// CLAUDE.md "Design tokens"). There is no M3 token per colour, so this maps
// GROUP_COLOURS to plain Tailwind palette classes with dark: variants —
// swatch/border for the pill and the group header, soft background for a
// "done" cell, text for the small metric line inside it.

import type { GroupColour } from "@/lib/results-grid";

export interface GroupColourClasses {
  swatch: string;
  border: string;
  bgSoft: string;
  text: string;
}

export const GROUP_COLOUR_CLASSES: Record<GroupColour, GroupColourClasses> = {
  violet: {
    swatch: "bg-violet-500 dark:bg-violet-400",
    border: "border-violet-400 dark:border-violet-500",
    bgSoft: "bg-violet-100 dark:bg-violet-950/50",
    text: "text-violet-700 dark:text-violet-300",
  },
  teal: {
    swatch: "bg-teal-500 dark:bg-teal-400",
    border: "border-teal-400 dark:border-teal-500",
    bgSoft: "bg-teal-100 dark:bg-teal-950/50",
    text: "text-teal-700 dark:text-teal-300",
  },
  amber: {
    swatch: "bg-amber-500 dark:bg-amber-400",
    border: "border-amber-400 dark:border-amber-500",
    bgSoft: "bg-amber-100 dark:bg-amber-950/50",
    text: "text-amber-700 dark:text-amber-300",
  },
  rose: {
    swatch: "bg-rose-500 dark:bg-rose-400",
    border: "border-rose-400 dark:border-rose-500",
    bgSoft: "bg-rose-100 dark:bg-rose-950/50",
    text: "text-rose-700 dark:text-rose-300",
  },
  blue: {
    swatch: "bg-blue-500 dark:bg-blue-400",
    border: "border-blue-400 dark:border-blue-500",
    bgSoft: "bg-blue-100 dark:bg-blue-950/50",
    text: "text-blue-700 dark:text-blue-300",
  },
  green: {
    swatch: "bg-green-500 dark:bg-green-400",
    border: "border-green-400 dark:border-green-500",
    bgSoft: "bg-green-100 dark:bg-green-950/50",
    text: "text-green-700 dark:text-green-300",
  },
  // 0192: seven and eight, so planner-only groups (Account owner, Running
  // the account) can still take a colour no results group is using.
  sky: {
    swatch: "bg-sky-500 dark:bg-sky-400",
    border: "border-sky-400 dark:border-sky-500",
    bgSoft: "bg-sky-100 dark:bg-sky-950/50",
    text: "text-sky-700 dark:text-sky-300",
  },
  fuchsia: {
    swatch: "bg-fuchsia-500 dark:bg-fuchsia-400",
    border: "border-fuchsia-400 dark:border-fuchsia-500",
    bgSoft: "bg-fuchsia-100 dark:bg-fuchsia-950/50",
    text: "text-fuchsia-700 dark:text-fuchsia-300",
  },
};

/** Grey lanes for compared years: shade 1 (last year) is lightest, 3 (three+
 * years back) is darkest — same shade in every row for a given year, per the
 * mockup. Built from the M3 surface-container ramp, not a hex.
 *
 * Starts at `-container` (skipping `-low`, which sits only ~1.5L% off the
 * page's plain `surface` white and was indistinguishable from the current
 * year's row) so shade 1 already reads as a band, and ends at `-highest` for
 * real separation between all three steps in both themes. */
export const LANE_SHADE_CLASSES: Record<1 | 2 | 3, string> = {
  1: "bg-m-surface-container",
  2: "bg-m-surface-container-high",
  3: "bg-m-surface-container-highest",
};
