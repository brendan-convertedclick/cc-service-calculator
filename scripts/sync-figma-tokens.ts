#!/usr/bin/env tsx
/**
 * Pulls variables from a Figma file and writes them into tokens/base.json.
 *
 * Requires env vars (set in `.env.local`):
 *   - FIGMA_ACCESS_TOKEN  — personal access token with `file_variables:read` scope
 *   - FIGMA_FILE_KEY      — the file key of your CC design system
 *
 * Convention for Figma variable names (collection/group/name):
 *   color/primary, color/on-primary, color/primary-container, color/on-primary-container,
 *   color/secondary, ... color/surface, color/surface-container, color/outline, ...
 *   radius/xs, radius/sm, radius/md, ...
 *
 * The script:
 *   1. Calls GET /v1/files/{key}/variables/local
 *   2. Walks the variable collection, extracts light/dark mode values for each color,
 *      and static values for non-color tokens.
 *   3. Merges into tokens/base.json (preserves typography + elevation which live in code
 *      until Figma adds number variables for them).
 *   4. Writes meta.generatedAt + meta.figmaFileKey.
 *
 * Run:   npm run tokens:sync
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const token = process.env.FIGMA_ACCESS_TOKEN;
const fileKey = process.env.FIGMA_FILE_KEY;

if (!token || !fileKey) {
  console.error(
    "[sync] missing FIGMA_ACCESS_TOKEN and/or FIGMA_FILE_KEY.\n" +
      "       set them in .env.local and re-run. See .env.example for the shape."
  );
  process.exit(1);
}

type FigmaColor = { r: number; g: number; b: number; a: number };

interface FigmaVariableValue {
  type: "VARIABLE_ALIAS" | "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  value: FigmaColor | number | string | boolean | { type: "VARIABLE_ALIAS"; id: string };
}

interface FigmaVariable {
  id: string;
  name: string;                     // e.g. "color/primary" or nested "color/primary/default"
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, FigmaVariableValue["value"]>;
  variableCollectionId: string;
}

interface FigmaVariableCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
}

interface FigmaVariablesResponse {
  status: number;
  error: boolean;
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}

function rgbaToHex(c: FigmaColor): string {
  const to255 = (n: number) => Math.round(n * 255);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(to255(c.r))}${hex(to255(c.g))}${hex(to255(c.b))}`.toUpperCase();
}

// "color/primary" → { group: "color", name: "primary" }
// "color/primary/default" → { group: "color", name: "primary-default" }
function splitVarName(full: string): { group: string; name: string } {
  const parts = full.split("/").map((s) => s.trim());
  if (parts.length < 2) return { group: "misc", name: full };
  const [group, ...rest] = parts;
  return { group: group.toLowerCase(), name: rest.join("-") };
}

// kebab → camelCase
function kebabToCamel(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// Heuristic: which Figma mode is "light" vs "dark"?
function resolveModes(collection: FigmaVariableCollection): { lightId: string; darkId: string } {
  const byName = new Map(collection.modes.map((m) => [m.name.toLowerCase(), m.modeId]));
  const lightId = byName.get("light") ?? byName.get("default") ?? collection.defaultModeId;
  const darkId = byName.get("dark") ?? collection.modes.find((m) => m.modeId !== lightId)?.modeId ?? lightId;
  return { lightId, darkId };
}

async function fetchVariables(): Promise<FigmaVariablesResponse> {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token! } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Figma API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as FigmaVariablesResponse;
}

function resolveAlias(
  value: FigmaVariableValue["value"],
  variables: Record<string, FigmaVariable>,
  modeId: string,
  seen = new Set<string>()
): FigmaVariableValue["value"] {
  if (value && typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") {
    const targetId = (value as { type: "VARIABLE_ALIAS"; id: string }).id;
    if (seen.has(targetId)) return value;
    seen.add(targetId);
    const target = variables[targetId];
    if (!target) return value;
    const next = target.valuesByMode[modeId];
    return next === undefined ? value : resolveAlias(next, variables, modeId, seen);
  }
  return value;
}

async function main() {
  console.log(`[sync] fetching variables from Figma file ${fileKey}`);
  const data = await fetchVariables();
  const { variables, variableCollections } = data.meta;

  const basePath = resolve(root, "tokens/base.json");
  const existing = JSON.parse(readFileSync(basePath, "utf8"));

  const color: Record<string, { light: string; dark: string }> = {};
  const radius: Record<string, string> = {};

  let matched = 0;
  for (const v of Object.values(variables)) {
    const { group, name } = splitVarName(v.name);
    const collection = variableCollections[v.variableCollectionId];
    if (!collection) continue;
    const { lightId, darkId } = resolveModes(collection);

    if (group === "color" && v.resolvedType === "COLOR") {
      const lightVal = resolveAlias(v.valuesByMode[lightId], variables, lightId);
      const darkVal = resolveAlias(v.valuesByMode[darkId], variables, darkId);
      if (!isColor(lightVal) || !isColor(darkVal)) continue;
      color[kebabToCamel(name)] = {
        light: rgbaToHex(lightVal),
        dark: rgbaToHex(darkVal),
      };
      matched++;
    } else if (group === "radius" && v.resolvedType === "FLOAT") {
      const val = resolveAlias(v.valuesByMode[collection.defaultModeId], variables, collection.defaultModeId);
      if (typeof val !== "number") continue;
      radius[kebabToCamel(name)] = `${val / 16}rem`;
      matched++;
    }
  }

  if (matched === 0) {
    console.warn(
      "[sync] no variables matched the naming convention (color/<role>, radius/<size>).\n" +
        "       check your Figma file names or consult scripts/sync-figma-tokens.ts for the schema."
    );
  }

  const merged = {
    ...existing,
    meta: {
      ...existing.meta,
      source: "figma",
      generatedAt: new Date().toISOString(),
      figmaFileKey: fileKey,
    },
    color: { ...existing.color, ...color },
    radius: Object.keys(radius).length > 0 ? { ...existing.radius, ...radius } : existing.radius,
  };

  writeFileSync(basePath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`[sync] wrote ${basePath} — ${matched} variable(s) merged.`);
}

function isColor(v: unknown): v is FigmaColor {
  return !!v && typeof v === "object" && "r" in v && "g" in v && "b" in v;
}

main().catch((err) => {
  console.error("[sync] failed:", err.message || err);
  process.exit(1);
});
