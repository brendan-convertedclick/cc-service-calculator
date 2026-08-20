export type OutboundEmailStatus = "draft" | "sent" | "send_failed";

export type OutboundEmailRow = {
  id: string;
  project_id: string | null;
  brief_id: string | null;
  client_id: string | null;
  composed_by: string;
  template: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  body_html: string;
  body_text: string;
  drive_link: string | null;
  approval_link: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  status: OutboundEmailStatus;
  send_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailTemplateRow = {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  variables: string[];
  created_at: string;
  updated_at: string;
};

/**
 * Replace `{placeholder}` tokens with their values. Unknown placeholders are
 * left as-is so the operator notices them and fills in.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_, key) => vars[key] ?? `{${key}}`);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The `{placeholder}` tokens interpolate() left behind, deduped and in the
 * order they appear.
 *
 * interpolate's contract is that an unknown token stays visible so the operator
 * fills it in — but visible only works if someone looks. On 2026-08-20 a
 * template opened with no project in context sent "Approval needed —
 * {project_name}" to a real person. Compose calls this before sending and
 * refuses, which is the part that was missing.
 */
export function unresolvedPlaceholders(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const [, key] of text.matchAll(PLACEHOLDER)) found.add(key);
  }
  return [...found];
}
