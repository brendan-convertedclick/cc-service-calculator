import { describe, expect, it } from "vitest";
import {
  computeSubtotalCents,
  resolveSowDoc,
  resolveSowDocument,
  lintSowDoc,
} from "./sow-doc";
import { buildVariableBag } from "./sow-variables";
import {
  ALL_FIXTURES,
  CLIENT_OVERRIDE,
  EMPTY_TEMPLATE,
  FALSE_ZERO_OVERRIDE,
  MULTI_LINE_WITH_DISCOUNT,
  REGISTRY,
  SINGLE_SERVICE_TABLE,
  UNKNOWN_VARIABLE,
  type SowFixture,
} from "@/test/fixtures/sow";

describe("computeSubtotalCents", () => {
  it.each(ALL_FIXTURES)("$name → expected billable subtotal", (f: SowFixture) => {
    expect(computeSubtotalCents(f.doc.body)).toBe(f.expectedBillableCents);
  });

  it("counts only new_billable lines, ignoring in_agreed_scope and out_of_scope", () => {
    // SINGLE_SERVICE_TABLE has an in-scope (80000) and out-of-scope (500000) line
    // that must NOT count toward billable.
    expect(computeSubtotalCents(SINGLE_SERVICE_TABLE.doc.body)).toBe(200000);
  });
});

describe("resolveSowDocument — end to end", () => {
  it("EMPTY_TEMPLATE resolves to no sections and zero totals", () => {
    const r = resolveSowDocument({ body: EMPTY_TEMPLATE.doc.body, registry: REGISTRY });
    expect(r.doc.sections).toHaveLength(0);
    expect(r.billableTotalCents).toBe(0);
    expect(r.lint.ok).toBe(true);
  });

  it("SINGLE_SERVICE_TABLE publishes subtotal and computes total incl VAT", () => {
    const r = resolveSowDocument({
      body: SINGLE_SERVICE_TABLE.doc.body,
      registry: REGISTRY,
    });
    expect(r.billableTotalCents).toBe(200000);
    expect(r.bag["pricing.subtotal_cents"].value).toBe(200000);
    expect(r.bag["pricing.total_incl_vat_cents"].value).toBe(230000);
  });

  it("substitutes a known prose token with its formatted value", () => {
    const r = resolveSowDocument({
      body: SINGLE_SERVICE_TABLE.doc.body,
      registry: REGISTRY,
      clientOverrides: { "client.name": "Client A Pty" },
    });
    const intro = r.doc.sections.find((s) => s.id === "intro");
    expect(intro?.kind).toBe("prose");
    if (intro?.kind === "prose") {
      expect(intro.resolvedMarkdown).toContain("Client A Pty");
      const chip = intro.tokens.find((t) => t.key === "client.name");
      expect(chip?.known).toBe(true);
      expect(chip?.formatted).toBe("Client A Pty");
      expect(chip?.source).toBe("client");
    }
  });

  it("MULTI_LINE rounds fractional line totals at the cent", () => {
    const r = resolveSowDocument({ body: MULTI_LINE_WITH_DISCOUNT.doc.body, registry: REGISTRY });
    expect(r.billableTotalCents).toBe(170000);
  });
});

describe("scenarios re-resolve the bag (the what-if engine)", () => {
  it("a scenario override beats the document override and recomputes the total", () => {
    const base = resolveSowDocument({
      body: CLIENT_OVERRIDE.doc.body,
      registry: REGISTRY,
      clientOverrides: CLIENT_OVERRIDE.clientOverrides,
    });
    expect(base.bag["pricing.total_incl_vat_cents"].value).toBe(230000); // 15% VAT

    const whatIf = resolveSowDocument({
      body: CLIENT_OVERRIDE.doc.body,
      registry: REGISTRY,
      clientOverrides: CLIENT_OVERRIDE.clientOverrides,
      scenarioOverrides: { "agency.vat_pct": 25 },
    });
    expect(whatIf.bag["pricing.total_incl_vat_cents"].value).toBe(250000); // 25% VAT
    expect(whatIf.bag["pricing.total_incl_vat_cents"].value).not.toBe(
      base.bag["pricing.total_incl_vat_cents"].value,
    );
  });
});

describe("FALSE_ZERO_OVERRIDE", () => {
  it("honours a 0 document override in the resolved prose", () => {
    const r = resolveSowDocument({
      body: FALSE_ZERO_OVERRIDE.doc.body,
      registry: REGISTRY,
      docOverrides: FALSE_ZERO_OVERRIDE.doc.variable_overrides,
    });
    expect(r.bag["pricing.hourly_rate"].value).toBe(0);
    const rate = r.doc.sections.find((s) => s.id === "rate");
    if (rate?.kind === "prose") {
      // R0 — formatted as ZAR, not the R1 500 default
      expect(rate.resolvedMarkdown).not.toContain("1 500");
    }
  });
});

describe("lintSowDoc", () => {
  it("UNKNOWN_VARIABLE: flags an undefined prose token and is not ok", () => {
    const r = resolveSowDocument({ body: UNKNOWN_VARIABLE.doc.body, registry: REGISTRY });
    expect(r.lint.ok).toBe(false);
    expect(r.lint.unknownVariables).toContain("client.unknown_field");
    const intro = r.doc.sections.find((s) => s.id === "intro");
    if (intro?.kind === "prose") {
      // unknown token is left visible (not silently blanked)
      expect(intro.resolvedMarkdown).toContain("{{client.unknown_field}}");
    }
  });

  it("a fully-resolved doc lints clean", () => {
    const bag = buildVariableBag(REGISTRY, { "pricing.subtotal_cents": 200000 });
    const doc = resolveSowDoc(SINGLE_SERVICE_TABLE.doc.body, bag);
    expect(lintSowDoc(doc).ok).toBe(true);
  });
});
