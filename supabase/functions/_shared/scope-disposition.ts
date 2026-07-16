// Pure deterministic disposition resolver for the Scope Ledger Rail.
//
// The LLM extracts + matches each inbound ask to a Xero catalog SKU (code,
// quantity, grounding quote, confidence). It NEVER decides coverage or money.
// This function is the single source of truth for coverage: given one extracted
// ask, the client's allowance ledger, and the catalog (keyed by Xero code), it
// assigns exactly one of three dispositions.
//
// ZERO imports — pure TypeScript so it is safe to import from both Deno edge
// functions and Node/vitest.

export type Disposition = "in_agreed_scope" | "new_billable" | "out_of_scope";

/** One discrete ask extracted + SKU-matched by the LLM. */
export interface ExtractedAsk {
  item_name: string;
  /** Xero catalog code the LLM matched, or null when no confident match. */
  matched_service_code: string | null;
  quantity: number;
  grounding_quote: string | null;
  /** 0–1 confidence from the LLM. */
  confidence: number;
}

/** A single coverage entitlement the client holds for one service. */
export interface ClientAllowance {
  service_id: string;
  /**
   * Remaining allowance quantity. `null` means "unlimited / membership-style"
   * (no per-occurrence cap), which always covers the ask.
   */
  allowance_qty: number | null;
  source: "retainer" | "project";
}

/** Minimal catalog projection keyed by Xero code. */
export interface CatalogService {
  id: string;
  code: string;
  is_deliverable: boolean;
  sell_price_cents: number;
}

export interface DispositionResult {
  disposition: Disposition;
  needs_review: boolean;
  /** Short human-readable explanation of the branch taken. */
  reason: string;
  /**
   * Client-safe explanation of the same branch — no SKU codes, no internal
   * ledger language. Used as the fallback `client_reason` on a placement when
   * intake didn't write one (or its expected bucket disagreed with this
   * resolver, in which case this template wins).
   */
  client_reason: string;
}

/**
 * Assign exactly one disposition to an ask using the client's allowance ledger.
 *
 * Branch logic (deterministic, money-free):
 *  - No matched SKU, or matched a non-deliverable SKU (spend / pass-through /
 *    software) → out_of_scope.
 *  - SKU covered by a project (fixed-price) allowance → in_agreed_scope
 *    (membership only in V1 — quantity is not metered).
 *  - SKU covered by a retainer allowance → in_agreed_scope when the monthly
 *    allowance is unlimited (null) or >= the asked quantity; otherwise the
 *    whole ask is new_billable (overage; no consumption ledger in V1).
 *  - SKU is deliverable but not in the ledger → new_billable.
 *
 * `needs_review` is set independently of disposition whenever the LLM was not
 * confident (< 0.6) or produced a non-positive / non-finite quantity.
 */
export function resolveDisposition(
  ask: ExtractedAsk,
  allowances: ClientAllowance[],
  catalogByCode: Map<string, CatalogService>,
): DispositionResult {
  const svc = ask.matched_service_code
    ? catalogByCode.get(ask.matched_service_code)
    : undefined;

  const needs_review =
    ask.confidence < 0.6 ||
    !Number.isFinite(ask.quantity) ||
    ask.quantity <= 0;

  if (!svc || !svc.is_deliverable) {
    const reason = !svc
      ? ask.matched_service_code
        ? `No catalog service for code "${ask.matched_service_code}"`
        : "No matched service code"
      : `Service ${svc.code} is non-deliverable (spend / pass-through)`;
    return {
      disposition: "out_of_scope",
      needs_review,
      reason,
      client_reason:
        "This isn't a service under our current agreement — we're happy to discuss it as a separate engagement.",
    };
  }

  const allow = allowances.find((a) => a.service_id === svc.id);

  if (allow) {
    if (allow.source === "project") {
      return {
        disposition: "in_agreed_scope",
        needs_review,
        reason: `Covered by fixed-price project membership for ${svc.code}`,
        client_reason:
          "Included in your current project — no additional charge.",
      };
    }
    // retainer
    if (allow.allowance_qty == null || allow.allowance_qty >= ask.quantity) {
      return {
        disposition: "in_agreed_scope",
        needs_review,
        reason:
          allow.allowance_qty == null
            ? `Covered by retainer (unlimited allowance) for ${svc.code}`
            : `Within retainer allowance (${ask.quantity} ≤ ${allow.allowance_qty}) for ${svc.code}`,
        client_reason: "Covered by your retainer — no additional charge.",
      };
    }
    return {
      disposition: "new_billable",
      needs_review,
      reason: `Retainer allowance exhausted (${ask.quantity} > ${allow.allowance_qty}) for ${svc.code}`,
      client_reason: `Your retainer covers ${allow.allowance_qty} of this per month — this request goes beyond that, so it's quoted as new work.`,
    };
  }

  return {
    disposition: "new_billable",
    needs_review,
    reason: `Deliverable ${svc.code} not in client's agreed scope`,
    client_reason:
      "Not part of your current retainer or projects — quoted as new work in this estimate.",
  };
}
