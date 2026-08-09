import type { Matcher } from "@testing-library/react";

/**
 * Matches text that RTL's default matcher misses because it is split across
 * elements — numbers throughout the app are wrapped in
 * `<span class="font-mono tabular-nums">`, so "69%" is two text nodes.
 *
 * Returns the innermost matching element so queries stay unambiguous.
 */
export function textAcross(expected: string | RegExp): Matcher {
  const hits = (el: Element | null) => {
    const text = el?.textContent ?? "";
    return typeof expected === "string" ? text.includes(expected) : expected.test(text);
  };
  return (_content: string, element: Element | null) =>
    hits(element) && !Array.from(element?.children ?? []).some(hits);
}
