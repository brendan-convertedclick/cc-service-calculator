// src/lib/format.ts
export function formatCurrency(zar: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(zar);
}

const numberFormatter = new Intl.NumberFormat("en-ZA");

/** en-ZA thousands separators, no currency symbol. */
export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}
