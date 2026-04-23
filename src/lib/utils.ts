import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
