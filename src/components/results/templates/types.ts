// src/components/results/templates/types.ts
//
// A draft field is what the editor holds locally before Save: the same shape
// useSaveTemplate writes (EditableField), plus a stable client-side key for
// React lists — `id` is undefined for a field nobody has saved yet, so it
// can't be the key.

import type { EditableField } from "@/hooks/useResults";

export interface DraftField extends EditableField {
  _key: string;
}

export const TYPE_LABELS: Record<DraftField["type"], string> = {
  number: "Number",
  money: "Rand",
  percent: "Percent",
  date: "Date",
  text: "Text",
};

export const NUMERIC_TYPES: DraftField["type"][] = ["number", "money", "percent"];
