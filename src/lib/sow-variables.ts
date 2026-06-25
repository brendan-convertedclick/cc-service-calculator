// src/lib/sow-variables.ts
//
// Pure variable-registry resolver for the Scope Composer. No React, no
// Supabase — buildVariableBag() is the deterministic heart shared by the
// product UI, the live "Scenarios" runner, the PDF renderer, and the golden
// tests, exactly like buildScopeReceipt().
//
// Resolution precedence (highest wins), presence-checked so a 0/false override
// is honoured and never silently reverts to a default:
//
//     document override > client override > record value > registry default
//
// Computed variables hold a small arithmetic expression over other keys; they
// are evaluated in dependency order (Kahn topological sort) AFTER cycles are
// rejected. The expression evaluator is a tiny hand-rolled recursive-descent
// parser — NEVER eval()/Function() on operator input.

import { formatCurrency } from "@/lib/format";
import type {
  OverrideMap,
  ResolvedVar,
  VariableBag,
  VariableDef,
  VariableType,
  VarSource,
} from "@/types/sow-composer";

const has = (m: OverrideMap, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(m, key);

// ── Expression evaluator (no eval) ────────────────────────────────────────────

type Node =
  | { k: "num"; v: number }
  | { k: "id"; name: string }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%"; l: Node; r: Node };

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "%" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /\s+|(\d+(?:\.\d+)?)|([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)|([+\-*/%()])/g;
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = re.exec(expr)) !== null) {
    if (m.index !== pos) {
      throw new Error(`Unexpected token in expression "${expr}" at ${pos}`);
    }
    pos = re.lastIndex;
    if (m[0].trim() === "") continue; // whitespace
    if (m[1] !== undefined) tokens.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "id", v: m[2] });
    else if (m[3] === "(") tokens.push({ t: "lp" });
    else if (m[3] === ")") tokens.push({ t: "rp" });
    else tokens.push({ t: "op", v: m[3] as "+" | "-" | "*" | "/" | "%" });
  }
  if (pos !== expr.length) {
    throw new Error(`Unexpected token in expression "${expr}" at ${pos}`);
  }
  return tokens;
}

/** Recursive-descent parser: add < mul < unary < primary. */
function parse(expr: string): Node {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  function parsePrimary(): Node {
    const tok = peek();
    if (!tok) throw new Error(`Unexpected end of expression "${expr}"`);
    if (tok.t === "lp") {
      eat();
      const e = parseAdd();
      if (peek()?.t !== "rp") throw new Error(`Expected ")" in "${expr}"`);
      eat();
      return e;
    }
    if (tok.t === "num") {
      eat();
      return { k: "num", v: tok.v };
    }
    if (tok.t === "id") {
      eat();
      return { k: "id", name: tok.v };
    }
    throw new Error(`Unexpected token in "${expr}"`);
  }

  function parseUnary(): Node {
    const tok = peek();
    if (tok && tok.t === "op" && tok.v === "-") {
      eat();
      return { k: "neg", e: parseUnary() };
    }
    return parsePrimary();
  }

  function parseMul(): Node {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === "op" && (tok.v === "*" || tok.v === "/" || tok.v === "%")) {
        eat();
        left = { k: "bin", op: tok.v, l: left, r: parseUnary() };
      } else break;
    }
    return left;
  }

  function parseAdd(): Node {
    let left = parseMul();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === "op" && (tok.v === "+" || tok.v === "-")) {
        eat();
        left = { k: "bin", op: tok.v, l: left, r: parseMul() };
      } else break;
    }
    return left;
  }

  const ast = parseAdd();
  if (i !== tokens.length) throw new Error(`Trailing tokens in "${expr}"`);
  return ast;
}

/** All dotted identifiers referenced by an expression. */
export function expressionIdentifiers(expr: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.k) {
      case "id":
        out.add(n.name);
        break;
      case "neg":
        walk(n.e);
        break;
      case "bin":
        walk(n.l);
        walk(n.r);
        break;
    }
  };
  walk(parse(expr));
  return [...out];
}

function evalNode(n: Node, scope: (id: string) => number): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "id":
      return scope(n.name);
    case "neg":
      return -evalNode(n.e, scope);
    case "bin": {
      const l = evalNode(n.l, scope);
      const r = evalNode(n.r, scope);
      switch (n.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
        case "%":
          return r === 0 ? 0 : l % r;
      }
    }
  }
}

/** Evaluate an expression against a numeric scope. Throws on parse errors. */
export function evaluateExpression(expr: string, scope: (id: string) => number): number {
  return evalNode(parse(expr), scope);
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** A computed var carries no display type; infer one from its key suffix. */
function displayType(type: VariableType, key: string): VariableType {
  if (type !== "computed") return type;
  if (key.endsWith("_cents")) return "currency_cents";
  if (key.endsWith("_pct") || key.endsWith("_percent")) return "percent";
  return "number";
}

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format a resolved value for display. Currency uses en-ZA ZAR via formatCurrency. */
export function formatValue(type: VariableType, value: unknown, key = ""): string {
  if (value === null || value === undefined || value === "") return "";
  const dt = displayType(type, key);
  switch (dt) {
    case "currency_cents":
      return formatCurrency(Math.round(toNum(value)) / 100);
    case "percent":
      return `${toNum(value)}%`;
    case "boolean":
      return value ? "Yes" : "No";
    case "date": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });
    }
    case "number":
      return String(toNum(value));
    default:
      return String(value);
  }
}

/** Format an already-resolved variable. */
export function formatVar(resolved: ResolvedVar): string {
  return formatValue(resolved.type, resolved.value, resolved.key);
}

// ── The resolver ──────────────────────────────────────────────────────────────

function resolveLayer(
  key: string,
  def: VariableDef | undefined,
  docOverrides: OverrideMap,
  clientOverrides: OverrideMap,
  recordValues: OverrideMap,
): { value: unknown; source: VarSource } {
  if (has(docOverrides, key)) return { value: docOverrides[key], source: "document" };
  if (has(clientOverrides, key)) return { value: clientOverrides[key], source: "client" };
  if (has(recordValues, key)) return { value: recordValues[key], source: "record" };
  if (def) return { value: def.default_value ?? null, source: "registry" };
  return { value: null, source: "registry" };
}

function inferType(value: unknown): VariableType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

/**
 * Build the resolved variable bag.
 *
 * @param registry        all sow_variables rows (global + template + computed)
 * @param recordValues    record-sourced values (client.name from the clients
 *                        row, document.date = today, pricing.subtotal_cents
 *                        auto-published by a service_table section)
 * @param clientOverrides clients.variable_overrides (sparse)
 * @param docOverrides     sow_documents.variable_overrides (sparse, highest)
 */
export function buildVariableBag(
  registry: VariableDef[],
  recordValues: OverrideMap = {},
  clientOverrides: OverrideMap = {},
  docOverrides: OverrideMap = {},
): VariableBag {
  const defByKey = new Map(registry.map((d) => [d.key, d]));
  const valueDefs = registry.filter((d) => d.type !== "computed");
  const computedDefs = registry.filter((d) => d.type === "computed");

  const bag: VariableBag = {};

  // 1) Value variables — registry rows plus any ad-hoc keys present only in the
  //    override/record layers (e.g. the auto-published pricing.subtotal_cents).
  const valueKeys = new Set<string>(valueDefs.map((d) => d.key));
  for (const m of [recordValues, clientOverrides, docOverrides]) {
    for (const k of Object.keys(m)) {
      if (!defByKey.get(k) || defByKey.get(k)!.type !== "computed") valueKeys.add(k);
    }
  }

  for (const key of valueKeys) {
    const def = defByKey.get(key);
    const { value, source } = resolveLayer(key, def, docOverrides, clientOverrides, recordValues);
    const type = def?.type ?? inferType(value);
    bag[key] = { key, type, value, formatted: formatValue(type, value, key), source };
  }

  // 2) Computed variables — honour an explicit override first, else evaluate in
  //    dependency order. Cycles are rejected.
  const toEvaluate = computedDefs.filter(
    (d) =>
      !has(docOverrides, d.key) && !has(clientOverrides, d.key) && !has(recordValues, d.key),
  );

  // Overridden computed keys resolve like value vars.
  for (const d of computedDefs) {
    if (toEvaluate.includes(d)) continue;
    const { value, source } = resolveLayer(d.key, d, docOverrides, clientOverrides, recordValues);
    bag[d.key] = {
      key: d.key,
      type: d.type,
      value,
      formatted: formatValue(d.type, value, d.key),
      source,
    };
  }

  const order = topoSortComputed(toEvaluate);
  for (const d of order) {
    const raw = evaluateExpression(d.expression ?? "0", (id) => toNum(bag[id]?.value));
    // Round at the cents boundary so float drift (100000 * 1.15 = 114999.99…)
    // never leaks into money — mirrors rollupCE's Math.round on cents.
    const value = displayType(d.type, d.key) === "currency_cents" ? Math.round(raw) : raw;
    bag[d.key] = {
      key: d.key,
      type: d.type,
      value,
      formatted: formatValue(d.type, value, d.key),
      source: "computed",
    };
  }

  return bag;
}

/**
 * Kahn topological sort over computed variables, ordering each after the
 * computed vars it references. Throws on a dependency cycle.
 */
export function topoSortComputed(defs: VariableDef[]): VariableDef[] {
  const keys = new Set(defs.map((d) => d.key));
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const deps = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();

  for (const d of defs) {
    const refs = new Set(
      expressionIdentifiers(d.expression ?? "").filter((id) => keys.has(id) && id !== d.key),
    );
    deps.set(d.key, refs);
    indeg.set(d.key, refs.size);
  }

  const queue = [...defs.filter((d) => (indeg.get(d.key) ?? 0) === 0)].map((d) => d.key);
  const ordered: VariableDef[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    ordered.push(byKey.get(k)!);
    for (const d of defs) {
      const r = deps.get(d.key)!;
      if (r.has(k)) {
        r.delete(k);
        indeg.set(d.key, (indeg.get(d.key) ?? 1) - 1);
        if ((indeg.get(d.key) ?? 0) === 0) queue.push(d.key);
      }
    }
  }

  if (ordered.length !== defs.length) {
    const cyclic = defs
      .filter((d) => !ordered.includes(d))
      .map((d) => d.key)
      .join(", ");
    throw new Error(`Computed variable cycle detected: ${cyclic}`);
  }
  return ordered;
}
