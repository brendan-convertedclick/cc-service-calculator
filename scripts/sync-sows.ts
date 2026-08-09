// scripts/sync-sows.ts
//
// Read SoW markdown files from the cc-vault wiki and upsert into the
// public.master_sows Supabase table. Used by `npm run sync-sows`.
//
// Source layout (default): ../CC-Vault/cc-vault/wiki/sow/*.md
// Override via SOW_DIR env var.
//
// Required env (in .env.local):
//   SUPABASE_URL                  — same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY     — service-role secret (NOT Vite-prefixed
//                                   so Vite cannot bundle it)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOW_DIR = resolve(process.env.SOW_DIR ?? "../CC-Vault/cc-vault/wiki/sow");
const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env (.env.local).");
  process.exit(1);
}

type Row = { slug: string; title: string; body_md: string };

function listMd(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && !n.startsWith("_"))
    .filter((n) => statSync(join(dir, n)).isFile());
}

function firstHeading(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

async function main() {
  const supabase = createClient(URL!, SR_KEY!);
  const files = listMd(SOW_DIR);
  const rows: Row[] = files.map((f) => {
    const body = readFileSync(join(SOW_DIR, f), "utf8");
    const slug = basename(f, ".md");
    return { slug, title: firstHeading(body, slug), body_md: body };
  });

  const { error } = await supabase
    .from("master_sows")
    .upsert(rows, { onConflict: "slug" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
   
  console.log(`Upserted ${rows.length} SoWs to master_sows.`);
}

main();
