import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the M3 custom class groups so they don't collide.
// Without this, text-label-small and text-m-on-surface-variant both match the
// unknown text-* pattern and the last one wins — stripping the font-size class.
const m3TypeScale = [
  "display-large", "display-medium", "display-small",
  "headline-large", "headline-medium", "headline-small",
  "title-large", "title-medium", "title-small",
  "body-large", "body-medium", "body-small",
  "label-large", "label-medium", "label-small",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: m3TypeScale }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatZar(cents: number): string {
  return zarFormatter.format(cents / 100);
}

export function formatHours(hours: number): string {
  return `${hours.toFixed(2)} hr`;
}

/** Extract a readable message from anything thrown/rejected. Supabase PostgrestError
 * is a plain object ({ message, details, hint, code }), so `String(e)` yields
 * "[object Object]" and `e instanceof Error` is false — hence this helper. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
