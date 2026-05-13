export function evaluatePattern(pattern: string, email: string): boolean {
  const p = pattern.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  if (p.startsWith("*@")) return e.endsWith(p.slice(1));
  if (!p.includes("@")) return false;
  return p === e;
}
