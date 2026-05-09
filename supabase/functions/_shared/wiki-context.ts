// supabase/functions/_shared/wiki-context.ts
//
// Fetches all non-hidden markdown files from a client's wiki folder on GitHub
// and assembles them into a <client_context> XML block for AI prompts.
// Returns empty string if the folder does not exist (404) — never throws.

interface WikiFile {
  name: string;
  path: string;
  download_url: string;
  type: "file" | "dir";
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const k = line.slice(0, sep).trim();
    const v = line.slice(sep + 1).trim();
    fm[k] = v;
  }
  return fm;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function listDir(repo: string, path: string, pat: string): Promise<WikiFile[]> {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=main`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchRaw(downloadUrl: string, pat: string): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) throw new Error(`Raw fetch failed: ${res.status}`);
  return res.text();
}

export async function loadClientWikiContext(opts: {
  clientName: string;
  wikiPath: string;
  repo: string;
  pat: string;
}): Promise<string> {
  const { clientName, wikiPath, repo, pat } = opts;

  let files: WikiFile[];
  try {
    files = await listDir(repo, wikiPath, pat);
  } catch (err) {
    console.warn(`[wiki-context] listDir failed: ${err}`);
    return "";
  }
  if (files.length === 0) return "";

  const mdFiles = files.filter((f) => f.type === "file" && f.name.endsWith(".md"));
  if (mdFiles.length === 0) return "";

  const noteParts: string[] = [];
  for (const file of mdFiles) {
    if (!file.download_url) {
      console.warn(`[wiki-context] no download_url for ${file.path}, skipping`);
      continue;
    }

    let content: string;
    try {
      content = await fetchRaw(file.download_url, pat);
    } catch (err) {
      console.warn(`[wiki-context] fetch failed for ${file.path}: ${err}`);
      continue;
    }

    const fm = parseFrontmatter(content);
    if (String(fm["context"]).toLowerCase() === "hidden" || fm["context"] === true) {
      continue;
    }

    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    noteParts.push(`  <note path="${escapeXmlAttr(file.name)}">${body}</note>`);
  }

  if (noteParts.length === 0) return "";

  return [
    `<client_context client_name="${escapeXmlAttr(clientName)}" wiki_path="${escapeXmlAttr(wikiPath)}">`,
    ...noteParts,
    `</client_context>`,
  ].join("\n");
}

/**
 * Fetch a single markdown file from a GitHub repo by path.
 * Returns empty string on 404 or any error — never throws.
 */
export async function loadWikiFile(opts: {
  path: string;
  repo: string;
  pat: string;
}): Promise<string> {
  const { path, repo, pat } = opts;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=main`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return "";
    if (!res.ok) {
      console.warn(`[wiki-context] loadWikiFile ${res.status} for ${path}`);
      return "";
    }
    const meta = await res.json() as { download_url?: string };
    if (!meta.download_url) return "";
    const raw = await fetch(meta.download_url, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!raw.ok) return "";
    return await raw.text();
  } catch (e) {
    console.warn(`[wiki-context] loadWikiFile failed for ${path}: ${e}`);
    return "";
  }
}
