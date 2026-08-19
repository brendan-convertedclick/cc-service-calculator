/**
 * URL handling for system_definitions.doc_links (0129).
 *
 * Lives in lib/ rather than beside DocLinksField so that component file only
 * exports a component — the react-refresh rule, and the lint ratchet, both
 * care.
 */

/**
 * Normalises what someone actually pastes into something ClickUp can link.
 *
 * People paste "docs.google.com/document/d/…" as often as the full URL, and a
 * scheme-less string renders in the task description as plain text nobody can
 * click — so assume https rather than rejecting it. Anything that still isn't a
 * parseable http(s) URL is refused: doc_links is a plain text[] with no check
 * constraint, and a malformed entry would ship into the markdown as-is.
 */
export function normaliseDocLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Match a scheme with or without "//" — "mailto:x@y.com" has one and must be
  // rejected, not prefixed. Prefixing it produced "https://mailto:x@y.com",
  // which parses happily with "mailto:x" as userinfo and y.com as the host: a
  // non-web address smuggled in as a valid-looking link. The scheme charset
  // excludes "." on purpose so a scheme-less "example.com:8080/doc" still reads
  // as host:port rather than a scheme.
  const hasScheme = /^[a-z][a-z0-9+-]*:/i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in a link are either a mistake or a disguise, and these render
  // into a ClickUp description other people read.
  if (url.username || url.password) return null;
  // A bare hostname with no dot ("https://notes") parses fine but is never a
  // document anyone can reach from ClickUp.
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

/** Chip text: the host plus enough of the path to tell two docs apart. The full
 *  URL stays on the anchor's title, so nothing is actually hidden. */
export function docLinkLabel(link: string): string {
  try {
    const url = new URL(link);
    const path = url.pathname === "/" ? "" : url.pathname;
    const text = `${url.hostname.replace(/^www\./, "")}${path}`;
    return text.length > 44 ? `${text.slice(0, 43)}…` : text;
  } catch {
    return link;
  }
}
