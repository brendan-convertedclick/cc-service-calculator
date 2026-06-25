import { describe, expect, it } from "vitest";
import {
  buildVariableBag,
  evaluateExpression,
  expressionIdentifiers,
  formatValue,
  topoSortComputed,
} from "./sow-variables";
import type { VariableDef } from "@/types/sow-composer";

function def(over: Partial<VariableDef> & { key: string; type: VariableDef["type"] }): VariableDef {
  return {
    id: over.key,
    label: null,
    scope: over.type === "computed" ? "computed" : "global",
    template_id: null,
    default_value: null,
    expression: null,
    enum_options: null,
    ...over,
  };
}

const REGISTRY: VariableDef[] = [
  def({ key: "client.name", type: "text", default_value: "Default Co" }),
  def({ key: "agency.vat_pct", type: "percent", default_value: 15 }),
  def({ key: "pricing.hourly_rate", type: "currency_cents", default_value: 150000 }),
  def({
    key: "pricing.total_incl_vat_cents",
    type: "computed",
    expression: "pricing.subtotal_cents * (1 + agency.vat_pct / 100)",
  }),
];

describe("expression evaluator (no eval)", () => {
  it("evaluates arithmetic with precedence and parens", () => {
    expect(evaluateExpression("2 + 3 * 4", () => 0)).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4", () => 0)).toBe(20);
    expect(evaluateExpression("-5 + 10", () => 0)).toBe(5);
    expect(evaluateExpression("10 % 3", () => 0)).toBe(1);
  });

  it("resolves dotted identifiers via the scope function", () => {
    const scope = (id: string) => ({ "a.b": 100, "c.d": 2 })[id] ?? 0;
    expect(evaluateExpression("a.b / c.d", scope)).toBe(50);
  });

  it("guards divide-by-zero to 0 rather than Infinity", () => {
    expect(evaluateExpression("5 / 0", () => 0)).toBe(0);
  });

  it("extracts referenced identifiers", () => {
    expect(expressionIdentifiers("pricing.subtotal_cents * (1 + agency.vat_pct / 100)").sort()).toEqual(
      ["agency.vat_pct", "pricing.subtotal_cents"],
    );
  });

  it("rejects malformed expressions", () => {
    expect(() => evaluateExpression("2 +", () => 0)).toThrow();
    expect(() => evaluateExpression("2 @ 3", () => 0)).toThrow();
  });
});

describe("buildVariableBag — override precedence", () => {
  it("falls through to registry defaults when nothing overrides", () => {
    const bag = buildVariableBag(REGISTRY);
    expect(bag["client.name"].value).toBe("Default Co");
    expect(bag["client.name"].source).toBe("registry");
    expect(bag["agency.vat_pct"].value).toBe(15);
  });

  it("applies precedence document > client > record > registry", () => {
    const bag = buildVariableBag(
      REGISTRY,
      { "client.name": "From Record" },
      { "client.name": "From Client" },
      { "client.name": "From Document" },
    );
    expect(bag["client.name"].value).toBe("From Document");
    expect(bag["client.name"].source).toBe("document");

    const bag2 = buildVariableBag(
      REGISTRY,
      { "client.name": "From Record" },
      { "client.name": "From Client" },
      {},
    );
    expect(bag2["client.name"].value).toBe("From Client");
    expect(bag2["client.name"].source).toBe("client");
  });

  it("FALSE_ZERO_OVERRIDE: a 0 override is honoured, not reverted to default", () => {
    // pricing.hourly_rate defaults to 150000 cents; a client negotiates R0.
    const bag = buildVariableBag(REGISTRY, {}, { "pricing.hourly_rate": 0 }, {});
    expect(bag["pricing.hourly_rate"].value).toBe(0);
    expect(bag["pricing.hourly_rate"].source).toBe("client");
    expect(bag["pricing.hourly_rate"].formatted).toBe(formatValue("currency_cents", 0));
  });

  it("a false boolean override is honoured", () => {
    const reg = [def({ key: "flags.show_terms", type: "boolean", default_value: true })];
    const bag = buildVariableBag(reg, {}, {}, { "flags.show_terms": false });
    expect(bag["flags.show_terms"].value).toBe(false);
    expect(bag["flags.show_terms"].source).toBe("document");
  });
});

describe("buildVariableBag — computed variables", () => {
  it("COMPUTED_VAT: evaluates total incl VAT from an auto-published subtotal", () => {
    // service_table publishes pricing.subtotal_cents as a record value.
    const bag = buildVariableBag(REGISTRY, { "pricing.subtotal_cents": 100000 });
    // 100000 * (1 + 15/100) = 115000
    expect(bag["pricing.total_incl_vat_cents"].value).toBe(115000);
    expect(bag["pricing.total_incl_vat_cents"].source).toBe("computed");
    // computed cents formats as ZAR currency via the _cents suffix heuristic
    expect(bag["pricing.total_incl_vat_cents"].formatted).toBe(formatValue("currency_cents", 115000));
  });

  it("honours an explicit override of a computed key instead of evaluating", () => {
    const bag = buildVariableBag(
      REGISTRY,
      { "pricing.subtotal_cents": 100000 },
      {},
      { "pricing.total_incl_vat_cents": 999 },
    );
    expect(bag["pricing.total_incl_vat_cents"].value).toBe(999);
    expect(bag["pricing.total_incl_vat_cents"].source).toBe("document");
  });

  it("COMPUTED_CYCLE: rejects a dependency cycle", () => {
    const cyclic: VariableDef[] = [
      def({ key: "calc.a", type: "computed", expression: "calc.b + 1" }),
      def({ key: "calc.b", type: "computed", expression: "calc.a * 2" }),
    ];
    expect(() => buildVariableBag(cyclic)).toThrow(/cycle/i);
    expect(() => topoSortComputed(cyclic)).toThrow(/cycle/i);
  });

  it("evaluates a chain of computed variables in dependency order", () => {
    const chain: VariableDef[] = [
      def({ key: "calc.total", type: "computed", expression: "calc.sub * 2" }),
      def({ key: "calc.sub", type: "computed", expression: "calc.base + 10" }),
    ];
    const bag = buildVariableBag(chain, { "calc.base": 5 });
    expect(bag["calc.sub"].value).toBe(15);
    expect(bag["calc.total"].value).toBe(30);
  });
});

describe("formatValue", () => {
  it("formats currency_cents as en-ZA ZAR", () => {
    expect(formatValue("currency_cents", 150000)).toMatch(/1[\s ]?500/); // R1 500
  });
  it("formats percent and empty values", () => {
    expect(formatValue("percent", 15)).toBe("15%");
    expect(formatValue("text", null)).toBe("");
    expect(formatValue("text", "Acme")).toBe("Acme");
  });
});
