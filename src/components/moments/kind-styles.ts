// src/components/moments/kind-styles.ts
//
// One colour per kind of moment, shared by the calendar and the Ask-about-soon
// list. Colour says what the day is, never how urgent it is.

import type { MomentKind } from "@/lib/contact-moments";

export const KIND_CHIP: Record<MomentKind, string> = {
  birthday: "bg-m-primary-container text-m-on-primary-container",
  event: "bg-m-tertiary-container text-m-on-tertiary-container",
  anniversary: "bg-m-secondary-container text-m-on-secondary-container",
};

export const KIND_DOT: Record<MomentKind, string> = {
  birthday: "bg-m-primary",
  event: "bg-m-tertiary",
  anniversary: "bg-m-secondary",
};
