// src/lib/format.ts
export function formatCurrency(zar: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(zar);
}
