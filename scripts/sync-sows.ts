/**
 * Read cc-vault wiki SoW markdown files and emit a bundled JSON at
 * src/data/master-sows.json.
 *
 * The draft-sow Edge Function receives this bundle as part of its request
 * payload; the bundle is checked in so production builds always have a
 * current snapshot. Rerun manually when a SoW is amended:
 *     npm run sync-sows
 *
 * Source layout (default): ../CC-Vault/cc-vault/wiki/sow/*.md
 * Override via SOW_DIR env var:
 *     SOW_DIR=/custom/path npm run sync-sows
 *
 * Excludes _index.md and anything starting with "_".
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const SOW_DIR = resolve(process.env.SOW_DIR ?? "../CC-Vault/cc-vault/wiki/sow");
const OUT = resolve("src/data/master-sows.json");

type SoW = { slug: string; title: string; body_md: string };

function listMd(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && !n.startsWith("_"))
    .filter((n) => statSync(join(dir, n)).isFile());
}

function firstHeading(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function main() {
  const files = listMd(SOW_DIR);
  const sows: SoW[] = files.map((f) => {
    const body = readFileSync(join(SOW_DIR, f), "utf8");
    const slug = basename(f, ".md");
    return { slug, title: firstHeading(body, slug), body_md: body };
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(sows, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${sows.length} SoWs to ${OUT}`);
}

main();
