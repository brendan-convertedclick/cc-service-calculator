# CC Calculator MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js MCP server that exposes 7 agency-aware tools (6 read + 1 idempotent write) so Claude agent sessions can find clients, check for duplicate briefs, look up active projects/retainers, and create pre-scoped briefs directly — without Apps Script or HMAC.

**Architecture:** Standalone TypeScript package at `mcp-server/` inside the repo. Uses `@modelcontextprotocol/sdk` with stdio transport. Each tool is a separate file exporting a Zod schema and async handler. `index.ts` wires them all together. Supabase service-role client is a shared singleton. Registered in `.mcp.json` alongside the existing `cc-supabase` entry.

**Tech Stack:** Node.js 20+, TypeScript 5, `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `zod`, `vitest`, `dotenv`

---

## File Map

| Action | Path |
|---|---|
| Create | `mcp-server/package.json` |
| Create | `mcp-server/tsconfig.json` |
| Create | `mcp-server/vitest.config.ts` |
| Create | `mcp-server/.env.example` |
| Create | `mcp-server/.gitignore` |
| Create | `mcp-server/src/supabase.ts` |
| Create | `mcp-server/src/auto-scope.ts` |
| Create | `mcp-server/src/tools/find-client.ts` |
| Create | `mcp-server/src/tools/find-client.test.ts` |
| Create | `mcp-server/src/tools/check-duplicate-brief.ts` |
| Create | `mcp-server/src/tools/check-duplicate-brief.test.ts` |
| Create | `mcp-server/src/tools/get-active-projects.ts` |
| Create | `mcp-server/src/tools/get-active-projects.test.ts` |
| Create | `mcp-server/src/tools/get-active-retainer.ts` |
| Create | `mcp-server/src/tools/get-active-retainer.test.ts` |
| Create | `mcp-server/src/tools/list-briefs.ts` |
| Create | `mcp-server/src/tools/list-briefs.test.ts` |
| Create | `mcp-server/src/tools/get-brief.ts` |
| Create | `mcp-server/src/tools/get-brief.test.ts` |
| Create | `mcp-server/src/tools/create-brief.ts` |
| Create | `mcp-server/src/tools/create-brief.test.ts` |
| Create | `mcp-server/src/index.ts` |
| Modify | `.mcp.json` |

---

## Task 1: Scaffold `mcp-server/` package

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/vitest.config.ts`
- Create: `mcp-server/.env.example`
- Create: `mcp-server/.gitignore`

- [ ] **Step 1: Create `mcp-server/package.json`**

```json
{
  "name": "cc-calculator-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@supabase/supabase-js": "^2.49.4",
    "dotenv": "^16.5.0",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@types/node": "^22.15.17",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.3"
  }
}
```

- [ ] **Step 2: Create `mcp-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 3: Create `mcp-server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `mcp-server/.env.example`**

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

- [ ] **Step 5: Create `mcp-server/.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Install dependencies**

```bash
cd /Users/brendangunn/Github/cc-service-calculator/mcp-server
npm install
```

Expected: `node_modules/` created, `package-lock.json` written. No errors.

- [ ] **Step 7: Copy `.env.example` to `.env` and fill in values**

```bash
cp mcp-server/.env.example mcp-server/.env
```

Open `mcp-server/.env` and paste in the values from `cc-service-calculator/.env.local`:
- `SUPABASE_URL` — same value as in `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` — find this in Supabase dashboard → Settings → API → service_role key

- [ ] **Step 8: Commit scaffold**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/package.json mcp-server/tsconfig.json mcp-server/vitest.config.ts \
        mcp-server/.env.example mcp-server/.gitignore
git commit -m "feat(mcp): scaffold mcp-server package"
```

---

## Task 2: Supabase singleton + auto-scope helper

**Files:**
- Create: `mcp-server/src/supabase.ts`
- Create: `mcp-server/src/auto-scope.ts`

- [ ] **Step 1: Create `mcp-server/src/supabase.ts`**

```typescript
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in mcp-server/.env')
}

export const supabase = createClient(url, key)
```

- [ ] **Step 2: Create `mcp-server/src/auto-scope.ts`**

This replicates the fire-and-forget pattern already used in `gmail-relay`. The MCP server calls it after creating a new brief.

```typescript
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * Fires auto-scope in the background after a new brief is created.
 * Never throws — failure is logged to stderr only.
 */
export function fireAutoScope(briefId: string): void {
  const url = `${SUPABASE_URL}/functions/v1/auto-scope`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ brief_id: briefId }),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[cc-calculator-mcp] auto-scope fire failed for ${briefId}: ${msg}`)
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/supabase.ts mcp-server/src/auto-scope.ts
git commit -m "feat(mcp): supabase singleton and auto-scope fire helper"
```

---

## Task 3: `find-client` tool

**Files:**
- Create: `mcp-server/src/tools/find-client.ts`
- Create: `mcp-server/src/tools/find-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mcp-server/src/tools/find-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockIlike = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ ilike: mockIlike }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./find-client.js')

describe('find-client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when client not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ email_domain: 'unknown.co.za' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns client when found by email_domain', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: 'acme.co.za' }
    mockMaybeSingle.mockResolvedValue({ data: client, error: null })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    expect(mockIlike).toHaveBeenCalledWith('primary_domain', '%acme.co.za%')
  })

  it('searches by name when email_domain is absent', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    await handler({ name: 'Acme' })
    expect(mockIlike).toHaveBeenCalledWith('name', '%Acme%')
  })

  it('returns error content on supabase error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('db error')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/brendangunn/Github/cc-service-calculator/mcp-server
npm test -- find-client
```

Expected: `Cannot find module './find-client.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/find-client.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  email_domain: z.string().optional().describe('Sender email domain e.g. acme.co.za'),
  name: z.string().optional().describe('Client name (partial match)'),
}).refine((d) => d.email_domain || d.name, { message: 'Provide email_domain or name' })

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  const field = input.email_domain ? 'primary_domain' : 'name'
  const value = (input.email_domain ?? input.name)!

  try {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, wiki_path, primary_domain')
      .ilike(field, `%${value}%`)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- find-client
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/find-client.ts mcp-server/src/tools/find-client.test.ts
git commit -m "feat(mcp): find-client tool"
```

---

## Task 4: `check-duplicate-brief` tool

**Files:**
- Create: `mcp-server/src/tools/check-duplicate-brief.ts`
- Create: `mcp-server/src/tools/check-duplicate-brief.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./check-duplicate-brief.js')

describe('check-duplicate-brief', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when thread not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ gmail_thread_id: 'thread-123' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns brief_id when thread already exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'brief-abc' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-123' })
    expect(JSON.parse(result.content[0].text)).toEqual({ brief_id: 'brief-abc' })
    expect(mockEq).toHaveBeenCalledWith('gmail_thread_id', 'thread-123')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- check-duplicate-brief
```

Expected: `Cannot find module './check-duplicate-brief.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/check-duplicate-brief.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  gmail_thread_id: z.string().describe('Gmail thread ID to check for duplicates'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const result = data ? { brief_id: data.id } : null
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- check-duplicate-brief
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/check-duplicate-brief.ts mcp-server/src/tools/check-duplicate-brief.test.ts
git commit -m "feat(mcp): check-duplicate-brief tool"
```

---

## Task 5: `get-active-projects` tool

**Files:**
- Create: `mcp-server/src/tools/get-active-projects.ts`
- Create: `mcp-server/src/tools/get-active-projects.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockData: unknown[] = []
const mockIn = vi.fn(() => Promise.resolve({ data: mockData, error: null }))
const mockEq = vi.fn(() => ({ in: mockIn }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-active-projects.js')

describe('get-active-projects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no active projects', async () => {
    mockIn.mockResolvedValue({ data: [], error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual([])
  })

  it('returns active projects for client', async () => {
    const projects = [{ id: 'proj-1', name: 'Website Redesign', project_code: 'WEB-001', status: 'active', created_at: '2026-01-01' }]
    mockIn.mockResolvedValue({ data: projects, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual(projects)
    expect(mockEq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(mockIn).toHaveBeenCalledWith('status', ['active', 'in_progress'])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- get-active-projects
```

Expected: `Cannot find module './get-active-projects.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/get-active-projects.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID to look up active projects for'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, project_code, status, created_at')
      .eq('client_id', input.client_id)
      .in('status', ['active', 'in_progress'])

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? []) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- get-active-projects
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/get-active-projects.ts mcp-server/src/tools/get-active-projects.test.ts
git commit -m "feat(mcp): get-active-projects tool"
```

---

## Task 6: `get-active-retainer` tool

**Files:**
- Create: `mcp-server/src/tools/get-active-retainer.ts`
- Create: `mcp-server/src/tools/get-active-retainer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockNotIn = vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) })) }))
const mockEqIntent = vi.fn(() => ({ not: vi.fn(() => mockNotIn()) }))
const mockEqClient = vi.fn(() => ({ eq: mockEqIntent }))
const mockSelect = vi.fn(() => ({ eq: mockEqClient }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-active-retainer.js')

describe('get-active-retainer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no active retainer', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns retainer summary when found', async () => {
    const row = {
      id: 'brief-ret',
      raw_subject: 'Monthly Retainer',
      scopes: { enhanced_prose: 'Monthly support retainer covering 20hrs of dev work.' },
    }
    mockMaybeSingle.mockResolvedValue({ data: row, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual({
      brief_id: 'brief-ret',
      subject: 'Monthly Retainer',
      scope_summary: 'Monthly support retainer covering 20hrs of dev work.',
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- get-active-retainer
```

Expected: `Cannot find module './get-active-retainer.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/get-active-retainer.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID to check for an active retainer brief'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select('id, raw_subject, scopes(enhanced_prose)')
      .eq('client_id', input.client_id)
      .eq('intent_type', 'retainer_thread')
      .not('status', 'in', '("closed","spam")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return { content: [{ type: 'text' as const, text: JSON.stringify(null) }] }

    const scope = Array.isArray(data.scopes) ? data.scopes[0] : data.scopes
    const result = {
      brief_id: data.id,
      subject: data.raw_subject,
      scope_summary: scope?.enhanced_prose ?? null,
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- get-active-retainer
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/get-active-retainer.ts mcp-server/src/tools/get-active-retainer.test.ts
git commit -m "feat(mcp): get-active-retainer tool"
```

---

## Task 7: `list-briefs` tool

**Files:**
- Create: `mcp-server/src/tools/list-briefs.ts`
- Create: `mcp-server/src/tools/list-briefs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResolve = vi.fn()
const mockLimit = vi.fn(() => mockResolve())
const mockOrder = vi.fn(() => ({ limit: mockLimit }))
const mockEq = vi.fn(() => ({ order: mockOrder, eq: vi.fn(() => ({ order: mockOrder })) }))
const mockSelect = vi.fn(() => ({ order: mockOrder, eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./list-briefs.js')

describe('list-briefs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns briefs list', async () => {
    const briefs = [{ id: 'b1', raw_subject: 'New website', sender_email: 'a@b.com', status: 'new', intent_type: 'new_brief', created_at: '2026-05-01', message_count: 1 }]
    mockResolve.mockResolvedValue({ data: briefs, error: null })
    const result = await handler({})
    expect(JSON.parse(result.content[0].text)).toEqual(briefs)
  })

  it('applies limit from input', async () => {
    mockResolve.mockResolvedValue({ data: [], error: null })
    await handler({ limit: 5 })
    expect(mockLimit).toHaveBeenCalledWith(5)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- list-briefs
```

Expected: `Cannot find module './list-briefs.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/list-briefs.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().optional().describe('Filter by client UUID'),
  status: z.string().optional().describe('Filter by status: new, triaged, needs_info, closed, spam'),
  intent_type: z.string().optional().describe('Filter by intent_type: new_brief, project_thread, retainer_thread, general_query, quick_response'),
  limit: z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    let query = supabase
      .from('briefs')
      .select('id, raw_subject, sender_email, status, intent_type, created_at, message_count')

    if (input.client_id) query = query.eq('client_id', input.client_id) as typeof query
    if (input.status) query = query.eq('status', input.status) as typeof query
    if (input.intent_type) query = query.eq('intent_type', input.intent_type) as typeof query

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(input.limit ?? 20)

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? []) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- list-briefs
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/list-briefs.ts mcp-server/src/tools/list-briefs.test.ts
git commit -m "feat(mcp): list-briefs tool"
```

---

## Task 8: `get-brief` tool

**Files:**
- Create: `mcp-server/src/tools/get-brief.ts`
- Create: `mcp-server/src/tools/get-brief.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-brief.js')

describe('get-brief', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns full brief with scope', async () => {
    const brief = {
      id: 'b1', raw_subject: 'New site', raw_body: 'We need...', sender_email: 'a@b.com',
      status: 'new', intent_type: 'new_brief', draft_reply: null,
      scopes: { enhanced_prose: 'Summary', in_scope_md: '- Website', out_of_scope_md: '', open_questions_md: '- Budget?', scope_type: 'new_brief' },
    }
    mockSingle.mockResolvedValue({ data: brief, error: null })
    const result = await handler({ brief_id: 'b1' })
    expect(JSON.parse(result.content[0].text)).toEqual(brief)
    expect(mockEq).toHaveBeenCalledWith('id', 'b1')
  })

  it('returns error content on not found', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const result = await handler({ brief_id: 'missing' })
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- get-brief
```

Expected: `Cannot find module './get-brief.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/get-brief.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id: z.string().describe('Brief UUID'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select(`
        id, raw_subject, raw_body, sender_email, status,
        intent_type, draft_reply, created_at, message_count,
        scopes(enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md, scope_type)
      `)
      .eq('id', input.brief_id)
      .single()

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- get-brief
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/get-brief.ts mcp-server/src/tools/get-brief.test.ts
git commit -m "feat(mcp): get-brief tool"
```

---

## Task 9: `create-brief` tool

**Files:**
- Create: `mcp-server/src/tools/create-brief.ts`
- Create: `mcp-server/src/tools/create-brief.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFireAutoScope = vi.fn()
vi.mock('../auto-scope.js', () => ({ fireAutoScope: mockFireAutoScope }))

const mockSingleDup = vi.fn()
const mockEqDup = vi.fn(() => ({ maybeSingle: mockSingleDup }))
const mockSelectDup = vi.fn(() => ({ eq: mockEqDup }))

const mockSingleInsert = vi.fn()
const mockSelectInsert = vi.fn(() => ({ single: mockSingleInsert }))
const mockInsert = vi.fn(() => ({ select: mockSelectInsert }))

const mockFrom = vi.fn()
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./create-brief.js')

describe('create-brief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'briefs' && mockFrom.mock.calls.filter(c => c[0] === 'briefs').length === 1) {
        return { select: mockSelectDup }
      }
      return { insert: mockInsert }
    })
  })

  it('returns existing brief_id without inserting when duplicate', async () => {
    mockSingleDup.mockResolvedValue({ data: { id: 'existing-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-1', subject: 'Hi', body: 'Hello', sender_email: 'a@b.com' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ brief_id: 'existing-brief', created: false })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockFireAutoScope).not.toHaveBeenCalled()
  })

  it('creates brief and fires auto-scope when thread is new', async () => {
    mockSingleDup.mockResolvedValue({ data: null, error: null })
    mockSingleInsert.mockResolvedValue({ data: { id: 'new-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-2', subject: 'New project', body: 'Details', sender_email: 'a@b.com', client_id: 'client-1' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ brief_id: 'new-brief', created: true })
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      gmail_thread_id: 'thread-2',
      raw_subject: 'New project',
      raw_body: 'Details',
      sender_email: 'a@b.com',
      client_id: 'client-1',
      source: 'gmail_relay',
      status: 'new',
    }))
    expect(mockFireAutoScope).toHaveBeenCalledWith('new-brief')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- create-brief
```

Expected: `Cannot find module './create-brief.js'`

- [ ] **Step 3: Implement `mcp-server/src/tools/create-brief.ts`**

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { fireAutoScope } from '../auto-scope.js'

export const schema = z.object({
  gmail_thread_id: z.string().describe('Gmail thread ID — used as dedup key'),
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Plain text email body'),
  sender_email: z.string().email().describe('Sender email address'),
  sender_name: z.string().optional().describe('Sender display name'),
  client_id: z.string().optional().describe('Client UUID from find-client; omit if sender is unknown'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    // Idempotency check
    const { data: existing } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (existing) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: existing.id, created: false }) }] }
    }

    // Insert new brief
    const { data: created, error } = await supabase
      .from('briefs')
      .insert({
        gmail_thread_id: input.gmail_thread_id,
        raw_subject: input.subject,
        raw_body: input.body,
        sender_email: input.sender_email,
        client_id: input.client_id ?? null,
        source: 'gmail_relay',
        status: 'new',
      })
      .select('id')
      .single()

    if (error || !created) throw new Error(error?.message ?? 'Insert failed')

    // Fire auto-scope in background — never blocks return
    fireAutoScope(created.id)

    return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: created.id, created: true }) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run to confirm passes**

```bash
npm test -- create-brief
```

Expected: `2 passed`

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass across all tool files.

- [ ] **Step 6: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/tools/create-brief.ts mcp-server/src/tools/create-brief.test.ts
git commit -m "feat(mcp): create-brief tool — idempotent insert + auto-scope trigger"
```

---

## Task 10: `index.ts` — wire everything together

**Files:**
- Create: `mcp-server/src/index.ts`

- [ ] **Step 1: Create `mcp-server/src/index.ts`**

```typescript
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import * as findClient from './tools/find-client.js'
import * as checkDuplicate from './tools/check-duplicate-brief.js'
import * as getActiveProjects from './tools/get-active-projects.js'
import * as getActiveRetainer from './tools/get-active-retainer.js'
import * as listBriefs from './tools/list-briefs.js'
import * as getBrief from './tools/get-brief.js'
import * as createBrief from './tools/create-brief.js'

const server = new McpServer({
  name: 'cc-calculator',
  version: '0.1.0',
})

server.tool(
  'find-client',
  'Find a client record by sender email domain or name. Returns { id, name, wiki_path, primary_domain } or null.',
  findClient.schema,
  findClient.handler,
)

server.tool(
  'check-duplicate-brief',
  'Check if a Gmail thread has already been ingested as a brief. Returns { brief_id } or null.',
  checkDuplicate.schema,
  checkDuplicate.handler,
)

server.tool(
  'get-active-projects',
  'List active and in-progress projects for a client. Returns array (may be empty).',
  getActiveProjects.schema,
  getActiveProjects.handler,
)

server.tool(
  'get-active-retainer',
  'Get the most recent active retainer brief for a client with its scope summary. Returns { brief_id, subject, scope_summary } or null.',
  getActiveRetainer.schema,
  getActiveRetainer.handler,
)

server.tool(
  'list-briefs',
  'List inbox briefs with optional filters. Returns array of brief summaries.',
  listBriefs.schema,
  listBriefs.handler,
)

server.tool(
  'get-brief',
  'Get a full brief including scope fields, intent_type, and draft_reply.',
  getBrief.schema,
  getBrief.handler,
)

server.tool(
  'create-brief',
  'Idempotently create a new brief from an email. Dedupes by gmail_thread_id, fires auto-scope in background. Returns { brief_id, created: bool }.',
  createBrief.schema,
  createBrief.handler,
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

- [ ] **Step 2: Build the server**

```bash
cd /Users/brendangunn/Github/cc-service-calculator/mcp-server
npm run build
```

Expected: `mcp-server/dist/index.js` and tool files created. No TypeScript errors. If you see errors about `.js` extensions, check that all imports in `src/` use `.js` extensions (e.g. `'../supabase.js'` not `'../supabase'`).

- [ ] **Step 3: Smoke test the server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node mcp-server/dist/index.js
```

Expected: JSON response listing all 7 tools with their names and descriptions.

- [ ] **Step 4: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add mcp-server/src/index.ts mcp-server/dist/
git commit -m "feat(mcp): wire all tools into McpServer, stdio transport"
```

---

## Task 11: Register in `.mcp.json` + add build to gitignore

**Files:**
- Modify: `.mcp.json`
- Modify: `.gitignore` (add `mcp-server/dist/` exclusion override or keep dist tracked)

- [ ] **Step 1: Update `.mcp.json`**

Replace the contents of `.mcp.json` with:

```json
{
  "mcpServers": {
    "cc-supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--project-ref=lpgwxacoqiqpcfpkklib"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN_CC_CALCULATOR}"
      }
    },
    "cc-calculator": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "cwd": "/Users/brendangunn/Github/cc-service-calculator"
    }
  }
}
```

Note: no `env` block needed — the server loads credentials from `mcp-server/.env` via `dotenv/config` at the top of `index.ts`.

- [ ] **Step 2: Verify Claude Code picks up the server**

Restart Claude Code (or run `/mcp` to reload). Confirm `cc-calculator` appears in the MCP server list with 7 tools.

- [ ] **Step 3: Run a live tool call to confirm end-to-end**

In a Claude Code session in any project, try:
```
Use the cc-calculator MCP to list the most recent 5 briefs.
```

Expected: Claude calls `list-briefs` with `{ limit: 5 }` and returns real brief data from the calculator DB.

- [ ] **Step 4: Commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add .mcp.json
git commit -m "feat(mcp): register cc-calculator server in .mcp.json"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Node.js TypeScript MCP server at `mcp-server/` | Task 1 |
| Supabase service-role singleton | Task 2 |
| fire-and-forget auto-scope helper | Task 2 |
| `find-client` tool | Task 3 |
| `check-duplicate-brief` tool | Task 4 |
| `get-active-projects` tool | Task 5 |
| `get-active-retainer` tool | Task 6 |
| `list-briefs` tool | Task 7 |
| `get-brief` tool | Task 8 |
| `create-brief` idempotent write + auto-scope | Task 9 |
| `index.ts` wires all tools, stdio transport | Task 10 |
| `.mcp.json` registration | Task 11 |
| Env loaded from `mcp-server/.env` via dotenv | Task 2 (`supabase.ts`) + Task 10 (`index.ts`) |
| Error handling — isError: true on failure | All tool tasks |

All spec requirements covered. No placeholders. Type names are consistent across all tasks (`Input`, `handler`, `schema`).
