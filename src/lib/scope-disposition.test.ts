import { describe, expect, it } from "vitest";
import {
  resolveDisposition,
  type CatalogService,
  type ClientAllowance,
  type ExtractedAsk,
} from "../../supabase/functions/_shared/scope-disposition";

// --- Fixtures ---------------------------------------------------------------

const deliverable: CatalogService = {
  id: "svc-page",
  code: "002",
  is_deliverable: true,
  sell_price_cents: 330000,
};

const nonDeliverable: CatalogService = {
  id: "svc-spend",
  code: "1000",
  is_deliverable: false,
  sell_price_cents: 0,
};

const catalogByCode = new Map<string, CatalogService>([
  [deliverable.code, deliverable],
  [nonDeliverable.code, nonDeliverable],
]);

function ask(overrides: Partial<ExtractedAsk> = {}): ExtractedAsk {
  return {
    item_name: "Landing page build",
    matched_service_code: "002",
    quantity: 1,
    grounding_quote: "Please build us a landing page.",
    confidence: 0.9,
    ...overrides,
  };
}

// --- Tests ------------------------------------------------------------------

describe("resolveDisposition", () => {
  it("no matched code → out_of_scope", () => {
    const r = resolveDisposition(ask({ matched_service_code: null }), [], catalogByCode);
    expect(r.disposition).toBe("out_of_scope");
    expect(r.needs_review).toBe(false);
    expect(r.reason).toMatch(/no matched service code/i);
  });

  it("matched a non-deliverable service → out_of_scope", () => {
    const r = resolveDisposition(ask({ matched_service_code: "1000" }), [], catalogByCode);
    expect(r.disposition).toBe("out_of_scope");
    expect(r.reason).toMatch(/non-deliverable/i);
  });

  it("retainer in-ledger, qty <= allowance → in_agreed_scope", () => {
    const allowances: ClientAllowance[] = [
      { service_id: "svc-page", allowance_qty: 4, source: "retainer" },
    ];
    const r = resolveDisposition(ask({ quantity: 3 }), allowances, catalogByCode);
    expect(r.disposition).toBe("in_agreed_scope");
  });

  it("retainer allowance exhausted (qty > allowance) → new_billable", () => {
    const allowances: ClientAllowance[] = [
      { service_id: "svc-page", allowance_qty: 2, source: "retainer" },
    ];
    const r = resolveDisposition(ask({ quantity: 5 }), allowances, catalogByCode);
    expect(r.disposition).toBe("new_billable");
    expect(r.reason).toMatch(/exhausted/i);
  });

  it("retainer with null (unlimited) allowance → in_agreed_scope regardless of qty", () => {
    const allowances: ClientAllowance[] = [
      { service_id: "svc-page", allowance_qty: null, source: "retainer" },
    ];
    const r = resolveDisposition(ask({ quantity: 999 }), allowances, catalogByCode);
    expect(r.disposition).toBe("in_agreed_scope");
  });

  it("project membership → in_agreed_scope (quantity not metered)", () => {
    const allowances: ClientAllowance[] = [
      { service_id: "svc-page", allowance_qty: 1, source: "project" },
    ];
    const r = resolveDisposition(ask({ quantity: 50 }), allowances, catalogByCode);
    expect(r.disposition).toBe("in_agreed_scope");
    expect(r.reason).toMatch(/membership/i);
  });

  it("deliverable not in ledger → new_billable", () => {
    const r = resolveDisposition(ask(), [], catalogByCode);
    expect(r.disposition).toBe("new_billable");
    expect(r.reason).toMatch(/not in client's agreed scope/i);
  });

  it("confidence < 0.6 → needs_review true (disposition still resolves)", () => {
    const r = resolveDisposition(ask({ confidence: 0.4 }), [], catalogByCode);
    expect(r.needs_review).toBe(true);
    expect(r.disposition).toBe("new_billable");
  });

  it("non-positive / non-finite quantity → needs_review true", () => {
    expect(resolveDisposition(ask({ quantity: 0 }), [], catalogByCode).needs_review).toBe(true);
    expect(resolveDisposition(ask({ quantity: -2 }), [], catalogByCode).needs_review).toBe(true);
    expect(resolveDisposition(ask({ quantity: NaN }), [], catalogByCode).needs_review).toBe(true);
  });
});

describe("client_reason (scope coverage fallback templates)", () => {
  it("every branch carries a non-empty, jargon-free client_reason", () => {
    const cases = [
      resolveDisposition(ask({ matched_service_code: null }), [], catalogByCode),
      resolveDisposition(ask({ matched_service_code: "1000" }), [], catalogByCode),
      resolveDisposition(
        ask(),
        [{ service_id: "svc-page", allowance_qty: null, source: "project" }],
        catalogByCode,
      ),
      resolveDisposition(
        ask(),
        [{ service_id: "svc-page", allowance_qty: 5, source: "retainer" }],
        catalogByCode,
      ),
      resolveDisposition(
        ask({ quantity: 9 }),
        [{ service_id: "svc-page", allowance_qty: 5, source: "retainer" }],
        catalogByCode,
      ),
      resolveDisposition(ask(), [], catalogByCode),
    ];
    for (const r of cases) {
      expect(r.client_reason.length).toBeGreaterThan(10);
      // Never leak SKU codes or internal ledger language to the client.
      expect(r.client_reason).not.toMatch(/002|1000|SKU|ledger|allowance_qty/);
    }
  });

  it("retainer overage names the covered monthly quantity", () => {
    const r = resolveDisposition(
      ask({ quantity: 9 }),
      [{ service_id: "svc-page", allowance_qty: 5, source: "retainer" }],
      catalogByCode,
    );
    expect(r.disposition).toBe("new_billable");
    expect(r.client_reason).toMatch(/covers 5/);
  });
});
