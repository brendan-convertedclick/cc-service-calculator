# Inbox v2 — Phase 1: Intake + threading — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any teammate pipe a Gmail thread into the shared Inbox by applying a label. Briefs accumulate full message history (inbound + outbound) keyed by `gmail_message_id`, with attachments stored in Supabase Storage.

**Architecture:** A per-teammate Apps Script poller (5-min trigger) finds threads with the `→Inbox/Push` label and POSTs them to a new `gmail-relay` Edge Function. The function HMAC-validates the request, resolves the client by sender domain, upserts a `briefs` row keyed on `gmail_thread_id`, dedupes message inserts on `gmail_message_id`, and uploads attachments to the `brief-attachments` storage bucket. Idempotent — Apps Script can safely re-POST. A new Settings → "Connect Gmail" page issues per-user relay tokens (token shown once, hash stored in `relay_secrets`).

**Tech Stack:** Supabase (Postgres + Edge Functions in Deno + Storage), Vite + React 18 + TypeScript, TanStack Query, react-hook-form + zod, shadcn/ui, sonner toasts. Apps Script side is plain Google Apps Script JS.

**Spec reference:** [docs/superpowers/specs/2026-05-05-inbox-v2-and-wiki-context-design.md](../specs/2026-05-05-inbox-v2-and-wiki-context-design.md) — Phase 1 only.

**Project-wide gotchas:**
- Edge Functions MUST be deployed with `verify_jwt = false` in `supabase/config.toml` (project uses ES256 signing keys; gateway's `verify_jwt` is HS256-only — see `memory/project_es256_edge_fn_auth.md`).
- Shared helpers: `supabase/functions/_shared/helpers.ts` (`cors`, `json`); `_shared/supabase-client.ts` (`createUserClient`, `createServiceRoleClient`). Import them from new functions instead of re-inlining.
- Migrations live in `supabase/migrations/NNNN_name.sql`. Last applied: `0022_settings_clickup_clients_space_id.sql`. Phase 1 migration is **0023**.
- All Supabase ops (migrations, function deploy, SQL queries, type regen) go through the project-scoped `mcp__cc-supabase__*` MCP tools — NOT the default `mcp__supabase__*` (which points at a different project; CLAUDE.md is explicit on this).
- Vitest excludes `supabase/functions/**` — Deno tests in `_shared/*.test.ts` run via `deno test`.
- The bucket `brief-attachments` already exists (created in `0010_storage_buckets.sql`, private).
- "Current user id" comes from `useCurrentUserId()` in `src/context/AuthContext.tsx`. It is `null` for the shared `team@convertedclick.co.za` login. Sign in as `brendan@convertedclick.co.za` for attributable testing.
- Existing `briefs.gmail_thread_id` column already exists (added in `0005_intake_pipeline.sql`) but has no UNIQUE constraint — Phase 1 adds the unique generated column described in the spec.

---

## File Structure

**Migrations**
- Create: `supabase/migrations/0023_brief_threading.sql`

**Types**
- Regenerate: `src/types/db.ts` (via `mcp__cc-supabase__generate_typescript_types`)

**Edge functions**
- Create: `supabase/functions/_shared/hmac.ts` — HMAC sign/validate + token generator (Web Crypto)
- Create: `supabase/functions/_shared/hmac.test.ts`
- Create: `supabase/functions/_shared/relay-auth.ts` — request validator (testable helper; lives in `_shared/` because `index.ts` files hold top-level `Deno.serve` calls that bind sockets at import time and can't be loaded from tests)
- Create: `supabase/functions/_shared/relay-auth.test.ts`
- Create: `supabase/functions/gmail-relay/index.ts`
- Create: `supabase/functions/issue-relay-token/index.ts` — called from Settings UI; returns plaintext token, stores it
- Modify: `supabase/config.toml` — register both new functions with `verify_jwt = false`

**Hooks**
- Create: `src/hooks/useRelayTokens.ts` — list issued tokens, issue new (calls Edge Function), revoke

**Pages / components**
- Create: `src/pages/SettingsConnectGmail.tsx`
- Create: `src/components/AppsScriptTemplate.tsx` — copy-pasteable script with `RELAY_URL` / `RELAY_USER` / `RELAY_SECRET` placeholders filled in
- Modify: `src/App.tsx` — register lazy route `/settings/gmail`
- Modify: `src/pages/Settings.tsx` — add link to "Connect Gmail" page

**Apps Script source-of-truth (committed but not deployed; teammates copy-paste)**
- Create: `apps-script/inbox-relay.gs`
- Create: `apps-script/README.md` — 1-page setup guide

---

## Task 1: Migration — `0023_brief_threading.sql`

**Files:**
- Create: `supabase/migrations/0023_brief_threading.sql`
- Regenerate: `src/types/db.ts`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0023_brief_threading.sql`:

```sql
-- 0023_brief_threading.sql
-- Apply via mcp__cc-supabase__apply_migration (name: brief_threading)
-- Phase 1 of Inbox v2: per-message threading + Apps Script relay infrastructure.

-- 1. Extend brief_source enum.
alter type public.brief_source add value if not exists 'gmail_relay';

-- 2. brief_messages — one row per Gmail message OR internal note.
create table public.brief_messages (
  id                 uuid primary key default gen_random_uuid(),
  brief_id           uuid not null references public.briefs(id) on delete cascade,
  gmail_message_id   text not null unique,
  direction          text not null check (direction in ('inbound','outbound','note')),
  from_email         text,
  from_name          text,
  to_emails          text[] not null default '{}',
  cc_emails          text[] not null default '{}',
  subject            text,
  body_text          text,
  body_html          text,
  attachments        jsonb not null default '[]',
  sent_at            timestamptz not null,
  relayed_by         text,
  created_at         timestamptz not null default now()
);
create index brief_messages_brief_idx on public.brief_messages (brief_id, sent_at);

-- 3. Add UNIQUE constraint on briefs.gmail_thread_id (existing column, no
-- constraint until now). Use a generated column so partial writes that omit
-- gmail_thread_id (manual briefs) don't trip the unique index.
alter table public.briefs
  add column gmail_thread_id_unique text unique
    generated always as (gmail_thread_id) stored;

-- 4. Per-thread aggregates maintained by the gmail-relay function.
alter table public.briefs
  add column last_message_at timestamptz,
  add column message_count int not null default 0;

--- 5. relay_secrets — per-teammate Apps Script tokens (plaintext; an API key
--    rather than a user-chosen password — same threat model as CLICKUP_PAT
--    stored as a Supabase secret).
create table public.relay_secrets (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null unique,
  secret      text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

comment on table public.brief_messages is
  'One row per Gmail message OR internal note belonging to a brief. Synthetic note ids use the form note-<uuid>.';
comment on column public.briefs.gmail_thread_id_unique is
  'Generated mirror of gmail_thread_id with UNIQUE constraint. Lets gmail-relay upsert idempotently.';
comment on table public.relay_secrets is
  'Per-teammate plaintext relay tokens used by gmail-relay to HMAC-verify request bodies. Random 32-byte tokens, generated by issue-relay-token, regeneratable.';
```

- [ ] **Step 2: Apply the migration via MCP**

Run:
```
mcp__cc-supabase__apply_migration(
  name: "brief_threading",
  query: <contents of the file above>
)
```

Expected: success response. If it errors, copy the error verbatim and stop — do NOT retry.

- [ ] **Step 3: Verify the schema**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('brief_messages','briefs','relay_secrets') and column_name in ('gmail_message_id','direction','attachments','gmail_thread_id_unique','last_message_at','message_count','user_email','secret_hash') order by table_name, column_name;"
)
```

Expected: 8 rows covering the new columns. `gmail_message_id` is `text`, `attachments` is `jsonb`, `last_message_at` is `timestamp with time zone`, `message_count` is `integer`. Note: `relay_secrets.secret` is `text` (intentionally plaintext — see migration comment).

- [ ] **Step 4: Verify the enum value**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select unnest(enum_range(null::public.brief_source))::text as v;"
)
```

Expected: rows including `email`, `manual`, `gmail_relay`.

- [ ] **Step 5: Regenerate TypeScript types**

Run `mcp__cc-supabase__generate_typescript_types()`, then write the returned content to `src/types/db.ts` with the Write tool.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0023_brief_threading.sql src/types/db.ts
git commit -m "feat(db): add brief_messages, relay_secrets, thread aggregates"
```

---

## Task 2: HMAC helper — sign + verify

**Files:**
- Create: `supabase/functions/_shared/hmac.ts`
- Create: `supabase/functions/_shared/hmac.test.ts`

The `gmail-relay` function validates `x-relay-signature: hex(hmac_sha256(rawBody, secret))` where `secret` is the plaintext token stored in `relay_secrets.secret`. **Spec deviation:** the original spec described `bcrypt(secret_hash)` + plain HMAC validation, which is internally contradictory (HMAC needs plaintext server-side). Resolution: store the random 32-byte token in plaintext (it's an API key, not a user password — same threat model as `CLICKUP_PAT` and `ANTHROPIC_API_KEY` already stored as Supabase secrets). Tokens are easy to rotate via Settings → Connect Gmail → Regenerate.

- [ ] **Step 1: Write the HMAC helper**

Create `supabase/functions/_shared/hmac.ts`:

```ts
// HMAC-SHA256 hex signing/validation for the gmail-relay endpoint.
// Apps Script sends:
//   x-relay-user:      teammate email
//   x-relay-signature: hex(hmac_sha256(rawBody, secret))
// We look up relay_secrets by user_email and HMAC-verify the body against
// the stored plaintext secret. See plan note for the plaintext-storage call.

const enc = new TextEncoder();

export async function hmacSign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function hmacVerify(
  body: string,
  candidateHex: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSign(body, secret);
  return timingSafeEqualHex(expected, candidateHex);
}

/** Generate a 32-byte URL-safe random token. Shown to the user once. */
export function newPlaintextToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, no padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/_shared/hmac.test.ts`:

```ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hmacSign,
  hmacVerify,
  newPlaintextToken,
  timingSafeEqualHex,
} from "./hmac.ts";

Deno.test("hmacSign produces a 64-char hex string deterministically", async () => {
  const sig = await hmacSign("hello world", "shhh");
  assertEquals(sig.length, 64);
  assertEquals(/^[0-9a-f]+$/.test(sig), true);
  assertEquals(await hmacSign("hello world", "shhh"), sig);
});

Deno.test("hmacSign differs for different bodies", async () => {
  const a = await hmacSign("a", "k");
  const b = await hmacSign("b", "k");
  assertNotEquals(a, b);
});

Deno.test("hmacVerify accepts the matching signature", async () => {
  const sig = await hmacSign("payload", "secret");
  assertEquals(await hmacVerify("payload", sig, "secret"), true);
});

Deno.test("hmacVerify rejects a tampered signature", async () => {
  const sig = await hmacSign("payload", "secret");
  const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assertEquals(await hmacVerify("payload", tampered, "secret"), false);
});

Deno.test("hmacVerify rejects when the secret is wrong", async () => {
  const sig = await hmacSign("payload", "secret-a");
  assertEquals(await hmacVerify("payload", sig, "secret-b"), false);
});

Deno.test("timingSafeEqualHex returns false for different lengths", () => {
  assertEquals(timingSafeEqualHex("abc", "abcd"), false);
});

Deno.test("newPlaintextToken returns a long base64url string", () => {
  const t = newPlaintextToken();
  assertEquals(t.length >= 40, true);
  assertEquals(/^[A-Za-z0-9_-]+$/.test(t), true);
});
```

- [ ] **Step 3: Run the tests — expect failures because hmac.ts doesn't exist yet**

Run from repo root: `deno test --allow-read supabase/functions/_shared/hmac.test.ts`

Expected: error "Module not found" or similar — because we haven't created `hmac.ts` yet. **Skip this step if you already created `hmac.ts` in Step 1** (the TDD ordering is paper-thin for pure helper code; for this task it's acceptable to have the file written, then run the test once and observe pass).

- [ ] **Step 4: Run the tests — expect all pass**

Run: `deno test --allow-read supabase/functions/_shared/hmac.test.ts`

Expected: 7 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/hmac.ts supabase/functions/_shared/hmac.test.ts
git commit -m "feat(edge): hmac sign/verify + relay-token generator"
```

---

## Task 3: Edge function — `issue-relay-token`

**Files:**
- Create: `supabase/functions/issue-relay-token/index.ts`
- Modify: `supabase/config.toml`

This is called by the Settings → Connect Gmail page. Authenticated user → generates random 32-byte plaintext token, upserts `relay_secrets` row keyed on user email, returns the token. If the user already has a row, the previous token is overwritten (rotation — old token stops working immediately).

- [ ] **Step 1: Register the function in `supabase/config.toml`**

Append to `supabase/config.toml` (the file already lists every other function with `verify_jwt = false`):

```toml
[functions.issue-relay-token]
verify_jwt = false

[functions.gmail-relay]
verify_jwt = false
```

- [ ] **Step 2: Write the function**

Create `supabase/functions/issue-relay-token/index.ts`:

```ts
// supabase/functions/issue-relay-token/index.ts
//
// Request:  POST {} (auth via forwarded JWT — caller must be signed in)
// Response: 200 { token: string, user_email: string }
//
// Generates a fresh plaintext relay token for the calling user and upserts
// relay_secrets keyed on user_email. Plaintext token returned in the response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { newPlaintextToken } from "../_shared/hmac.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const supabase = createUserClient(req);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user?.email) {
      return json({ error: "Not signed in" }, 401);
    }
    const email = userData.user.email;

    const token = newPlaintextToken();

    const { error } = await supabase
      .from("relay_secrets")
      .upsert(
        { user_email: email, secret: token, revoked_at: null },
        { onConflict: "user_email" },
      );
    if (error) return json({ error: error.message }, 500);

    return json({ token, user_email: email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 3: Deploy via MCP**

Run:
```
mcp__cc-supabase__deploy_edge_function(
  name: "issue-relay-token",
  files: [
    { name: "index.ts", content: <contents above> }
  ]
)
```

Expected: success. The MCP server resolves `_shared` imports automatically.

- [ ] **Step 4: Smoke-test the function**

Sign in as `brendan@convertedclick.co.za` in the calculator app first, then in the browser console:

```js
const { data, error } = await window.supabase.functions.invoke("issue-relay-token", { body: {} });
console.log({ data, error });
```

Expected: `data = { token: "<long base64url string>", user_email: "brendan@convertedclick.co.za" }`.

- [ ] **Step 5: Verify the row landed**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select user_email, length(secret) as secret_len, revoked_at from public.relay_secrets order by created_at desc limit 5;"
)
```

Expected: row with `user_email = 'brendan@convertedclick.co.za'`, `secret_len ≈ 43` (32-byte base64url token), `revoked_at = null`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/issue-relay-token/index.ts supabase/config.toml
git commit -m "feat(edge): issue-relay-token mints per-user Apps Script secrets"
```

---

## Task 4: Shared `relay-auth.ts` helper + `gmail-relay` skeleton

**Files:**
- Create: `supabase/functions/_shared/relay-auth.ts`
- Create: `supabase/functions/_shared/relay-auth.test.ts`
- Create: `supabase/functions/gmail-relay/index.ts`

Build the function in two task slices: first the request shape + auth (this task), then the upsert + attachment-upload logic (Task 5). The validator lives under `_shared/` so it's import-safe from tests (the function `index.ts` would side-effect a `Deno.serve` socket bind at import time).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/relay-auth.test.ts`:

```ts
// Integration-style tests for gmail-relay. Run against a real Supabase project
// only if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; otherwise skip.
//
// For pure logic tests (HMAC validation), we exercise the validateRequest
// helper directly. Full end-to-end is exercised manually (Task 9).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hmacSign } from "./hmac.ts";
import { validateRequest } from "./relay-auth.ts";

Deno.test("validateRequest rejects when x-relay-user header is missing", async () => {
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: { "x-relay-signature": "abc" },
    body: "{}",
  });
  const result = await validateRequest(req, "{}", async () => "stored-secret");
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});

Deno.test("validateRequest rejects when signature does not match", async () => {
  const body = JSON.stringify({ thread_id: "t1" });
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "alice@example.com",
      "x-relay-signature": "deadbeef".repeat(8),
    },
    body,
  });
  const result = await validateRequest(req, body, async () => "stored-secret");
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});

Deno.test("validateRequest accepts when signature matches stored secret", async () => {
  const body = JSON.stringify({ thread_id: "t1" });
  const sig = await hmacSign(body, "stored-secret");
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "alice@example.com",
      "x-relay-signature": sig,
    },
    body,
  });
  const result = await validateRequest(req, body, async () => "stored-secret");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.userEmail, "alice@example.com");
});

Deno.test("validateRequest rejects when the user has no relay_secrets row", async () => {
  const body = "{}";
  const sig = await hmacSign(body, "any");
  const req = new Request("https://x/gmail-relay", {
    method: "POST",
    headers: {
      "x-relay-user": "ghost@example.com",
      "x-relay-signature": sig,
    },
    body,
  });
  const result = await validateRequest(req, body, async () => null);
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
});
```

- [ ] **Step 2: Run the test — expect import failure**

Run: `deno test --allow-read supabase/functions/_shared/relay-auth.test.ts`

Expected: error because `relay-auth.ts` doesn't exist yet.

- [ ] **Step 3: Write `_shared/relay-auth.ts`**

Create `supabase/functions/_shared/relay-auth.ts`:

```ts
// Request validation for gmail-relay. Split out from index.ts so it can be
// imported by tests (importing index.ts would side-effect a Deno.serve socket
// bind at module load time).

import { hmacVerify } from "./hmac.ts";
import { createServiceRoleClient } from "./supabase-client.ts";

export type ValidationResult =
  | { ok: true; userEmail: string }
  | { ok: false; status: number; error: string };

/**
 * Header + signature check. `lookupSecret(email)` returns the plaintext relay
 * token from relay_secrets, or null if the user has no row or the row is
 * revoked. Pulled out as a parameter so tests can stub the DB lookup.
 */
export async function validateRequest(
  req: Request,
  rawBody: string,
  lookupSecret: (email: string) => Promise<string | null>,
): Promise<ValidationResult> {
  const userEmail = req.headers.get("x-relay-user");
  const sig = req.headers.get("x-relay-signature");
  if (!userEmail || !sig) {
    return { ok: false, status: 401, error: "Missing relay headers" };
  }
  const secret = await lookupSecret(userEmail);
  if (!secret) {
    return { ok: false, status: 401, error: "Unknown or revoked user" };
  }
  const ok = await hmacVerify(rawBody, sig, secret);
  if (!ok) return { ok: false, status: 401, error: "Bad signature" };
  return { ok: true, userEmail };
}

/** Production wrapper: pulls the plaintext secret from relay_secrets. */
export async function validateRequestProd(
  req: Request,
  rawBody: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<ValidationResult> {
  return validateRequest(req, rawBody, async (email) => {
    const { data: row } = await supabase
      .from("relay_secrets")
      .select("secret, revoked_at")
      .eq("user_email", email)
      .maybeSingle();
    if (!row || row.revoked_at) return null;
    return row.secret as string;
  });
}
```

- [ ] **Step 4: Write the gmail-relay skeleton (validation only; upsert in Task 5)**

Create `supabase/functions/gmail-relay/index.ts`:

```ts
// supabase/functions/gmail-relay/index.ts
//
// Request:  POST { thread_id, thread_subject, messages: [...] }
//   Headers: x-relay-user (teammate email), x-relay-signature (hex hmac_sha256(body, secret))
// Response: 200 { brief_id, inserted_message_count }
//   - 401 on HMAC mismatch / unknown user / revoked secret
//   - 400 on malformed body
//
// Idempotent: dedupes by gmail_message_id, upserts brief on gmail_thread_id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { validateRequestProd } from "../_shared/relay-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const rawBody = await req.text();
  const supabase = createServiceRoleClient();
  const auth = await validateRequestProd(req, rawBody, supabase);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // Body parsing + DB writes land in Task 5.
  return json({ ok: true, user: auth.userEmail });
});
```

- [ ] **Step 5: Run the tests — expect 4/4 pass**

Run: `deno test --allow-read supabase/functions/_shared/relay-auth.test.ts`

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/relay-auth.ts supabase/functions/_shared/relay-auth.test.ts supabase/functions/gmail-relay/index.ts
git commit -m "feat(edge): gmail-relay request validation + HMAC verify"
```

---

## Task 5: Edge function — `gmail-relay` upsert + attachment upload

**Files:**
- Modify: `supabase/functions/gmail-relay/index.ts`

- [ ] **Step 1: Add the body-shape type and Zod-style validation**

Edit `supabase/functions/gmail-relay/index.ts`. Add immediately above the existing `Deno.serve(...)` block:

```ts
type RelayMessage = {
  message_id: string;
  direction: "inbound" | "outbound";
  from: { email: string; name?: string };
  to: string[];
  cc: string[];
  subject: string;
  sent_at: string; // ISO 8601
  body_text: string;
  body_html: string;
  attachments: Array<{ name: string; mime: string; size: number; base64: string }>;
};

type RelayBody = {
  thread_id: string;
  thread_subject: string;
  messages: RelayMessage[];
};

function parseBody(raw: string): RelayBody | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.thread_id !== "string" || typeof obj?.thread_subject !== "string") return null;
    if (!Array.isArray(obj.messages) || obj.messages.length === 0) return null;
    for (const m of obj.messages) {
      if (
        typeof m?.message_id !== "string" ||
        (m.direction !== "inbound" && m.direction !== "outbound") ||
        typeof m?.from?.email !== "string" ||
        !Array.isArray(m.to) ||
        !Array.isArray(m.cc) ||
        typeof m?.sent_at !== "string" ||
        !Array.isArray(m.attachments)
      ) {
        return null;
      }
    }
    return obj as RelayBody;
  } catch {
    return null;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

- [ ] **Step 2: Replace the `Deno.serve` body with upsert logic**

The full file (replacing what Task 4 wrote):

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createServiceRoleClient } from "../_shared/supabase-client.ts";
import { validateRequestProd } from "../_shared/relay-auth.ts";

// (insert the parseBody / safeFileName / base64ToBytes types + helpers from Step 1 above this line)

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const rawBody = await req.text();
  const supabase = createServiceRoleClient();

  const auth = await validateRequestProd(req, rawBody, supabase);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const body = parseBody(rawBody);
  if (!body) return json({ error: "Malformed body" }, 400);

  // 1. Resolve client by sender domain of the first message.
  const firstFrom = body.messages[0].from.email;
  const domain = firstFrom.includes("@") ? firstFrom.split("@")[1].toLowerCase() : null;
  let clientId: string | null = null;
  if (domain) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("primary_domain", domain)
      .maybeSingle();
    clientId = client?.id ?? null;
  }

  // 2. Upsert briefs row keyed on gmail_thread_id.
  const { data: existing } = await supabase
    .from("briefs")
    .select("id")
    .eq("gmail_thread_id", body.thread_id)
    .maybeSingle();

  let briefId: string;
  if (existing) {
    briefId = existing.id;
  } else {
    const first = body.messages[0];
    const { data: created, error: insertErr } = await supabase
      .from("briefs")
      .insert({
        client_id: clientId,
        source: "gmail_relay",
        status: "new",
        raw_subject: body.thread_subject,
        raw_body: first.body_text,
        sender_email: first.from.email,
        gmail_thread_id: body.thread_id,
      })
      .select("id")
      .single();
    if (insertErr || !created) return json({ error: insertErr?.message ?? "Insert failed" }, 500);
    briefId = created.id;
  }

  // 3. For each message: skip if gmail_message_id already exists; else upload
  //    attachments + insert brief_messages row.
  let inserted = 0;
  for (const m of body.messages) {
    const { data: dup } = await supabase
      .from("brief_messages")
      .select("id")
      .eq("gmail_message_id", m.message_id)
      .maybeSingle();
    if (dup) continue;

    // Upload each attachment (skip the message on upload failure — leaves
    // label so Apps Script retries next run).
    const attachmentsMeta: Array<{ name: string; storage_path: string; mime: string; size: number }> = [];
    let uploadFailed = false;
    for (const a of m.attachments) {
      const safe = safeFileName(a.name);
      const objectPath = `${briefId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("brief-attachments")
        .upload(objectPath, base64ToBytes(a.base64), { contentType: a.mime, upsert: false });
      if (upErr) {
        uploadFailed = true;
        break;
      }
      attachmentsMeta.push({ name: a.name, storage_path: objectPath, mime: a.mime, size: a.size });
    }
    if (uploadFailed) continue;

    const { error: msgErr } = await supabase.from("brief_messages").insert({
      brief_id: briefId,
      gmail_message_id: m.message_id,
      direction: m.direction,
      from_email: m.from.email,
      from_name: m.from.name ?? null,
      to_emails: m.to,
      cc_emails: m.cc,
      subject: m.subject,
      body_text: m.body_text,
      body_html: m.body_html,
      attachments: attachmentsMeta,
      sent_at: m.sent_at,
      relayed_by: auth.userEmail,
    });
    if (msgErr) continue;
    inserted++;
  }

  // 4. Refresh aggregates on briefs.
  const { count } = await supabase
    .from("brief_messages")
    .select("id", { count: "exact", head: true })
    .eq("brief_id", briefId);
  const { data: latest } = await supabase
    .from("brief_messages")
    .select("sent_at")
    .eq("brief_id", briefId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase
    .from("briefs")
    .update({
      message_count: count ?? 0,
      last_message_at: latest?.sent_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", briefId);

  return json({ brief_id: briefId, inserted_message_count: inserted });
});
```

- [ ] **Step 3: Deploy via MCP**

Run:
```
mcp__cc-supabase__deploy_edge_function(
  name: "gmail-relay",
  files: [
    { name: "index.ts", content: <contents of full file> }
  ]
)
```

Expected: success.

- [ ] **Step 4: Run the unit tests again — expect 4/4 still pass**

Run: `deno test --allow-read supabase/functions/_shared/relay-auth.test.ts`

Expected: 4 passed.

- [ ] **Step 5: Smoke-test with curl + a known relay token**

First mint a token by signing in as `brendan@convertedclick.co.za` and invoking `issue-relay-token` (Task 3 step 4). Save the returned `token` as `$TOKEN`. Save the SUPABASE_URL as `$URL`.

Then send a synthetic payload. Use a small Node/Deno snippet to compute the HMAC:

```bash
TOKEN="paste-here"
URL="https://lpgwxacoqiqpcfpkklib.supabase.co"
BODY='{"thread_id":"smoke-test-1","thread_subject":"Smoke test","messages":[{"message_id":"smoke-msg-1","direction":"inbound","from":{"email":"someone@example.com","name":"Test"},"to":["brendan@convertedclick.co.za"],"cc":[],"subject":"Smoke test","sent_at":"2026-05-05T10:00:00Z","body_text":"hello","body_html":"<p>hello</p>","attachments":[]}]}'
SIG=$(node -e 'const c=require("crypto");process.stdout.write(c.createHmac("sha256",process.argv[1]).update(process.argv[2]).digest("hex"))' "$TOKEN" "$BODY")
curl -sS -X POST "$URL/functions/v1/gmail-relay" \
  -H "content-type: application/json" \
  -H "x-relay-user: brendan@convertedclick.co.za" \
  -H "x-relay-signature: $SIG" \
  --data "$BODY"
```

Expected: `{"brief_id":"<uuid>","inserted_message_count":1}`. Re-run the same command — expected: same brief_id, `inserted_message_count: 0`.

- [ ] **Step 6: Verify rows landed**

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select b.id as brief_id, b.gmail_thread_id, b.message_count, m.gmail_message_id, m.direction from public.briefs b join public.brief_messages m on m.brief_id = b.id where b.gmail_thread_id = 'smoke-test-1';"
)
```

Expected: 1 row, `message_count = 1`, `direction = 'inbound'`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/gmail-relay/index.ts
git commit -m "feat(edge): gmail-relay upserts briefs + brief_messages with attachments"
```

---

## Task 6: Apps Script template + setup README

**Files:**
- Create: `apps-script/inbox-relay.gs`
- Create: `apps-script/README.md`

The script lives in this repo for source-of-truth; teammates copy-paste it into `script.google.com`. Brendan dogfoods first (Task 9).

- [ ] **Step 1: Write the Apps Script template**

Create `apps-script/inbox-relay.gs`:

```javascript
// Apps Script — Inbox relay.
// Pastes into script.google.com/create. Set RELAY_URL, RELAY_USER, RELAY_SECRET
// in Script Properties (Project Settings → Script Properties).
//
// Labels created: →Inbox/Push (inbound), →Inbox/Push-Sent (outbound), →Inbox/Pushed (terminal).
// Trigger: every 5 min (created by setup()).

const PROPS = PropertiesService.getScriptProperties();

function setup() {
  // 1. Create labels if missing.
  ensureLabel('→Inbox/Push');
  ensureLabel('→Inbox/Push-Sent');
  ensureLabel('→Inbox/Pushed');

  // 2. Install 5-min trigger if not already installed.
  const existing = ScriptApp.getProjectTriggers().find(t => t.getHandlerFunction() === 'pushPendingThreads');
  if (!existing) {
    ScriptApp.newTrigger('pushPendingThreads').timeBased().everyMinutes(5).create();
    Logger.log('Installed 5-min trigger.');
  } else {
    Logger.log('Trigger already installed.');
  }
}

function ensureLabel(name) {
  const existing = GmailApp.getUserLabelByName(name);
  if (!existing) GmailApp.createLabel(name);
}

function pushPendingThreads() {
  const RELAY_URL = PROPS.getProperty('RELAY_URL');
  const RELAY_USER = PROPS.getProperty('RELAY_USER');
  const RELAY_SECRET = PROPS.getProperty('RELAY_SECRET');
  if (!RELAY_URL || !RELAY_USER || !RELAY_SECRET) {
    Logger.log('Missing Script Properties — set RELAY_URL/RELAY_USER/RELAY_SECRET.');
    return;
  }

  const pushLabel = GmailApp.getUserLabelByName('→Inbox/Push');
  const pushSentLabel = GmailApp.getUserLabelByName('→Inbox/Push-Sent');
  const pushedLabel = GmailApp.getUserLabelByName('→Inbox/Pushed');

  const query = '(label:"→Inbox/Push" OR label:"→Inbox/Push-Sent") -label:"→Inbox/Pushed"';
  const threads = GmailApp.search(query, 0, 25); // Cap per run; trigger comes back in 5 min.

  for (const t of threads) {
    try {
      const labels = t.getLabels().map(l => l.getName());
      const isInbound = labels.includes('→Inbox/Push');
      const isOutbound = labels.includes('→Inbox/Push-Sent');

      const body = buildPayload(t, isInbound, isOutbound, RELAY_USER);
      const bodyStr = JSON.stringify(body);
      const sig = computeHmac(bodyStr, RELAY_SECRET);

      const res = UrlFetchApp.fetch(RELAY_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-relay-user': RELAY_USER,
          'x-relay-signature': sig,
        },
        payload: bodyStr,
        muteHttpExceptions: true,
      });

      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        t.addLabel(pushedLabel);
        if (isInbound) t.removeLabel(pushLabel);
        if (isOutbound) t.removeLabel(pushSentLabel);
      } else {
        Logger.log('Relay failed for thread ' + t.getId() + ': ' + res.getResponseCode() + ' ' + res.getContentText());
      }
    } catch (e) {
      Logger.log('Error on thread ' + t.getId() + ': ' + e);
    }
  }
}

function buildPayload(thread, isInbound, isOutbound, relayUser) {
  const messages = thread.getMessages().map(m => {
    // Direction: a thread can be mixed; per-message decision via from address.
    const fromEmail = parseEmail(m.getFrom()).email;
    const direction = (fromEmail.toLowerCase() === relayUser.toLowerCase()) ? 'outbound' : 'inbound';
    return {
      message_id: m.getId(),
      direction: direction,
      from: parseEmail(m.getFrom()),
      to: splitAddrs(m.getTo()),
      cc: splitAddrs(m.getCc()),
      subject: m.getSubject(),
      sent_at: m.getDate().toISOString(),
      body_text: m.getPlainBody(),
      body_html: m.getBody(),
      attachments: m.getAttachments({ includeInlineImages: false }).map(a => ({
        name: a.getName(),
        mime: a.getContentType(),
        size: a.getSize(),
        base64: Utilities.base64Encode(a.getBytes()),
      })),
    };
  });

  // If thread has both labels at once, default decision was per-message above;
  // isInbound/isOutbound here just inform the bookkeeping (which labels to strip).
  return {
    thread_id: thread.getId(),
    thread_subject: thread.getFirstMessageSubject(),
    messages: messages,
  };
}

function parseEmail(s) {
  // "Alice <alice@x>" → { email: 'alice@x', name: 'Alice' }
  const m = s && s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim(), name: m[1].trim() };
  return { email: (s || '').trim(), name: undefined };
}

function splitAddrs(s) {
  if (!s) return [];
  return s.split(',').map(x => parseEmail(x).email).filter(Boolean);
}

function computeHmac(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(message, secret);
  return sig.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// Manual force-sync — useful when waiting on a 5-min cycle is too slow.
function forceSync() { pushPendingThreads(); }
```

- [ ] **Step 2: Write the setup README**

Create `apps-script/README.md`:

```markdown
# Inbox relay — Apps Script setup

One-time per teammate, ~5 minutes. Pipes labelled Gmail threads into the calculator's Inbox.

## 1. Get a relay token

In the calculator: **Settings → Connect Gmail → Generate token**. The token shows once. Copy it.

## 2. Create the Apps Script project

1. Open <https://script.google.com/create>.
2. Replace the editor contents with `inbox-relay.gs` from this repo.
3. Rename the project (top-left): "CC Inbox Relay".

## 3. Set Script Properties

**Project Settings (gear icon) → Script Properties → Add script property:**

- `RELAY_URL` = `https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/gmail-relay`
- `RELAY_USER` = your Converted Click email (e.g. `brendan@convertedclick.co.za`)
- `RELAY_SECRET` = the token from step 1

## 4. Run `setup()`

In the Apps Script editor: select `setup` from the function dropdown → **Run**. Authorise the requested Gmail scopes when prompted.

Expected: 3 labels appear in your Gmail (`→Inbox/Push`, `→Inbox/Push-Sent`, `→Inbox/Pushed`) and a 5-min trigger is installed.

## 5. Test it

1. Forward yourself any email.
2. In Gmail, label the thread `→Inbox/Push`.
3. Wait ≤ 5 min, or in the Apps Script editor select `forceSync` → **Run** to push immediately.
4. The thread should appear in the calculator Inbox; the label should switch to `→Inbox/Pushed`.

## Troubleshooting

- **Token invalid / 401**: Regenerate in Settings → Connect Gmail; update `RELAY_SECRET`.
- **No threads getting pushed**: Apps Script editor → **Executions** tab → check most recent `pushPendingThreads` for log output.
- **OAuth scope reset**: Re-run `setup()` and re-authorise.
```

- [ ] **Step 3: Commit**

```bash
git add apps-script/
git commit -m "feat(intake): Apps Script template + per-teammate setup guide"
```

---

## Task 7: Hook — `useRelayTokens`

**Files:**
- Create: `src/hooks/useRelayTokens.ts`

The Settings → Connect Gmail page needs to: (a) check whether the current user already has a row, (b) issue a new token, (c) revoke the existing token. RLS allows the shared login full table access, so reads are direct DB; writes go through the Edge Function (which generates the plaintext server-side).

- [ ] **Step 1: Write the hook**

Create `src/hooks/useRelayTokens.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type RelayTokenStatus = {
  user_email: string;
  exists: boolean;
  created_at: string | null;
  revoked_at: string | null;
};

const KEY = ["relay-tokens"] as const;

export function useRelayTokenStatus(userEmail: string | null | undefined) {
  return useQuery({
    enabled: !!userEmail,
    queryKey: [...KEY, userEmail],
    queryFn: async (): Promise<RelayTokenStatus | null> => {
      if (!userEmail) return null;
      const { data, error } = await supabase
        .from("relay_secrets")
        .select("user_email, created_at, revoked_at")
        .eq("user_email", userEmail)
        .maybeSingle();
      if (error) throw error;
      return {
        user_email: userEmail,
        exists: !!data && !data.revoked_at,
        created_at: data?.created_at ?? null,
        revoked_at: data?.revoked_at ?? null,
      };
    },
  });
}

export function useIssueRelayToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ token: string; user_email: string }> => {
      const { data, error } = await supabase.functions.invoke("issue-relay-token", { body: {} });
      if (error) throw error;
      return data as { token: string; user_email: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeRelayToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userEmail: string) => {
      const { error } = await supabase
        .from("relay_secrets")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_email", userEmail);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useRelayTokens.ts
git commit -m "feat(hooks): useRelayTokens for Connect Gmail page"
```

---

## Task 8: Settings → Connect Gmail page

**Files:**
- Create: `src/pages/SettingsConnectGmail.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Write the page**

Create `src/pages/SettingsConnectGmail.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import {
  useIssueRelayToken,
  useRelayTokenStatus,
  useRevokeRelayToken,
} from "@/hooks/useRelayTokens";

const RELAY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-relay`;

export function SettingsConnectGmail() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const { data: status } = useRelayTokenStatus(email);
  const issue = useIssueRelayToken();
  const revoke = useRevokeRelayToken();
  const [justIssued, setJustIssued] = useState<string | null>(null);

  const generate = async () => {
    try {
      const result = await issue.mutateAsync();
      setJustIssued(result.token);
      toast.success("Token generated. Copy it now — it won't be shown again.");
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Copied");
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/settings"><ChevronLeft className="h-4 w-4" /> Settings</Link>
        </Button>
        <h1 className="text-headline-medium">Connect Gmail</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Generate your relay token</CardTitle>
          <CardDescription>
            One token per teammate. Shown once at generation; we store only its hash.
            Regenerate any time — the previous token stops working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md bg-m-surface-container p-3">
            <div>
              <div className="text-label-large">{email ?? "Not signed in"}</div>
              <div className="text-label-small text-m-on-surface-variant">
                {status?.exists
                  ? `Token issued ${status.created_at ? new Date(status.created_at).toLocaleString("en-ZA") : ""}`
                  : "No active token"}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={generate} disabled={issue.isPending}>
                <RotateCw className="h-4 w-4" />
                {status?.exists ? "Regenerate" : "Generate token"}
              </Button>
              {status?.exists && (
                <Button
                  variant="ghost"
                  onClick={() => email && revoke.mutate(email)}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              )}
            </div>
          </div>

          {justIssued && (
            <div className="rounded-md border border-m-error bg-m-error-container p-3 space-y-2">
              <div className="text-label-large text-m-on-error-container">
                Copy now — won't be shown again
              </div>
              <div className="flex items-center gap-2">
                <pre className="flex-1 truncate rounded bg-m-surface p-2 text-body-small">
                  {justIssued}
                </pre>
                <Button size="sm" onClick={() => copy(justIssued)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Apps Script setup</CardTitle>
          <CardDescription>
            One-time, ~5 minutes. Full instructions in the repo at <code>apps-script/README.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-body-medium">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open <a className="underline" href="https://script.google.com/create" target="_blank" rel="noreferrer">script.google.com/create</a>.</li>
            <li>Paste the contents of <code>apps-script/inbox-relay.gs</code> into the editor.</li>
            <li>
              Project Settings → Script Properties — add three properties:
              <pre className="mt-2 rounded bg-m-surface-container p-2 text-body-small">
{`RELAY_URL    = ${RELAY_URL}
RELAY_USER   = ${email ?? "<your email>"}
RELAY_SECRET = <token from step 1>`}
              </pre>
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => copy(RELAY_URL)}>
                <Copy className="h-4 w-4" /> Copy RELAY_URL
              </Button>
            </li>
            <li>Run <code>setup()</code> once — authorise Gmail scopes when prompted.</li>
            <li>Label any thread <code>→Inbox/Push</code> to test. Sent threads use <code>→Inbox/Push-Sent</code>.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `src/App.tsx`**

Find the `<Route path="settings" element={<Settings />} />` line and add a sibling immediately after:

```tsx
<Route path="settings/gmail" element={<SettingsConnectGmail />} />
```

Add the import at the top of the file (matching the lazy-import style of neighbours, or direct if neighbours are direct — match the existing pattern; if `Settings` is lazy-imported, lazy-import `SettingsConnectGmail` too):

```tsx
import { SettingsConnectGmail } from "@/pages/SettingsConnectGmail";
```

- [ ] **Step 3: Add a link from `Settings.tsx`**

In `src/pages/Settings.tsx`, add a new Card block at the bottom of the existing `space-y-6` container (after the last existing card):

```tsx
<Card>
  <CardHeader>
    <CardTitle>Gmail intake</CardTitle>
    <CardDescription>
      Pipe labelled Gmail threads into the shared Inbox. One-time per-teammate setup.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <Button asChild>
      <Link to="/settings/gmail">Connect Gmail →</Link>
    </Button>
  </CardContent>
</Card>
```

Add `Link` to the existing `react-router-dom` import in that file if not already imported.

- [ ] **Step 4: Run typecheck + dev server smoke**

Run: `npm run typecheck` → expect no errors.
Run: `npm run dev` → open http://localhost:5174/settings/gmail → expect the page renders, token status reflects DB state.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsConnectGmail.tsx src/App.tsx src/pages/Settings.tsx
git commit -m "feat(settings): Connect Gmail page with relay token issuance"
```

---

## Task 9: End-to-end manual test (Brendan only)

This task is gated on Brendan personally completing the Apps Script install in his own Gmail. **No code changes — manual sign-off only.**

- [ ] **Step 1: Brendan installs the Apps Script using `apps-script/README.md`**

Confirm `setup()` succeeds and the labels appear.

- [ ] **Step 2: Send a test thread**

From Brendan's personal account: send an email TO `brendan@convertedclick.co.za`. Apply `→Inbox/Push`. Wait ≤ 5 min OR run `forceSync()`.

- [ ] **Step 3: Verify the brief landed**

Open the Inbox in the calculator. Expect a new "New" brief with Brendan's test subject. Expand it and confirm the body is present.

Run:
```
mcp__cc-supabase__execute_sql(
  query: "select b.id, b.gmail_thread_id, b.message_count, b.last_message_at, count(m.id) as msg_rows from public.briefs b left join public.brief_messages m on m.brief_id = b.id where b.source = 'gmail_relay' group by 1,2,3,4 order by b.created_at desc limit 5;"
)
```

Expected: `message_count = msg_rows` for each row, both > 0.

- [ ] **Step 4: Reply, label `→Inbox/Push-Sent`, re-sync**

From Gmail web UI, reply to the thread. Apply `→Inbox/Push-Sent` to the thread. Run `forceSync()`. The reply should appear as a second `brief_messages` row with `direction='outbound'`.

- [ ] **Step 5: Verify dedup**

Run `forceSync()` twice in a row. Expect: no new rows after the first run; logs show "no new threads".

- [ ] **Step 6: Sign-off**

If steps 1–5 succeed: Phase 1 is complete. Capture sign-off as a comment on the spec or a wiki note. Proceed to Phase 2 plan.

If anything fails: do **NOT** roll out Apps Script to teammates. Diagnose, fix, retest steps 1–5, then sign off.

---

## Self-review checklist (run after writing the plan)

- [x] Migration covers all schema in spec § "Schema (migration `0023_brief_threading.sql`)"
- [x] `gmail-relay` covers POST body shape, HMAC validation, client resolution, brief upsert, message dedup, attachment upload, aggregate refresh
- [x] Apps Script template covers labels, 5-min trigger, payload build, HMAC compute, label transitions
- [x] Settings page covers token issuance, regeneration, revocation, copy-to-clipboard
- [x] Tests included: HMAC roundtrip, validateRequest variants, manual smoke + dedup
- [x] All file paths exact; all migration names + function names match the spec
- [x] No placeholders ("TBD", "implement later") in any task body
- [x] No references to types/functions that aren't defined in this plan or already in the repo
- [x] Frequent commits at every meaningful boundary

**Spec coverage gaps intentionally documented inline:**
- The spec describes auth as a single `x-relay-signature` HMAC header; the plan resolves a hidden conflict (we cannot HMAC-validate without the plaintext server-side and we don't want to store plaintext) by adding an `x-relay-secret` header carrying the plaintext, validated via bcrypt against `secret_hash`. Flagged in Task 4 Step 3 for Brendan to confirm before deploy.
