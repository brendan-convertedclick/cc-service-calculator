// src/components/results/groupSections.ts
//
// The three sections a board group sits under (0194). A group's stored
// section wins; otherwise its name decides, so the standard groups need
// nothing set.

export const SECTIONS = ["acquisition", "presence", "account"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, { name: string; blurb: string }> = {
  acquisition: { name: "Acquisition", blurb: "Winning enquiries, open day bookings and enrolments" },
  presence: { name: "Presence", blurb: "Being seen and trusted in the area" },
  account: { name: "Account", blurb: "Running the relationship and the year" },
};

const BY_NAME: [RegExp, Section][] = [
  [/paid|event|campaign|content|guide|intake|form/i, "acquisition"],
  [/social|presence|review|reputation|profile/i, "presence"],
];

export function sectionFor(stored: string | null | undefined, groupName: string): Section {
  if (stored && (SECTIONS as readonly string[]).includes(stored)) return stored as Section;
  return BY_NAME.find(([re]) => re.test(groupName))?.[1] ?? "account";
}
