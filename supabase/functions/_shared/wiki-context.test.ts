// Run with: deno test supabase/functions/_shared/wiki-context.test.ts
import { assertEquals } from "jsr:@std/assert";
import { loadClientWikiContext } from "./wiki-context.ts";

const makeResponse = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

Deno.test("returns empty string when folder does not exist (404)", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(makeResponse({}, 404));
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result, "");
  globalThis.fetch = origFetch;
});

Deno.test("skips files with context: hidden frontmatter", async () => {
  const files = [{
    name: "index.md",
    path: "wiki/clients/Acme/index.md",
    download_url: "http://raw/index.md",
    type: "file",
  }];
  const hiddenContent = "---\ncontext: hidden\n---\n# Secret";
  const origFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = () => {
    call++;
    if (call === 1) return Promise.resolve(makeResponse(files));
    return Promise.resolve(makeResponse(hiddenContent, 200));
  };
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result, "");
  globalThis.fetch = origFetch;
});

Deno.test("assembles XML block from non-hidden files", async () => {
  const files = [{
    name: "brand.md",
    path: "wiki/clients/Acme/brand.md",
    download_url: "http://raw/brand.md",
    type: "file",
  }];
  const content = "# Brand\nVoice: friendly";
  const origFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = () => {
    call++;
    if (call === 1) return Promise.resolve(makeResponse(files));
    return Promise.resolve(makeResponse(content, 200));
  };
  const result = await loadClientWikiContext({
    clientName: "Acme",
    wikiPath: "wiki/clients/Acme",
    repo: "org/vault",
    pat: "token",
  });
  assertEquals(result.includes('<client_context client_name="Acme"'), true);
  assertEquals(result.includes("Voice: friendly"), true);
  globalThis.fetch = origFetch;
});
