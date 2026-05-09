# Claude Prompt Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Claude" section to the right sidebar of every applicable page — icon + label rows that copy a pre-built, context-rich prompt to clipboard for pasting into Claude Code.

**Architecture:** Three shared pieces (`ClaudePrompt` type, `useCopyPrompt` hook, `ClaudePromptPanel` component) are built first. Each page then defines its own `ClaudePrompt[]` inline as closures over local data and passes them to the panel. No central registry — prompt logic lives next to the data it uses.

**Tech Stack:** React 18, TypeScript, Tailwind + M3 tokens, Vitest + Testing Library, Lucide icons, `navigator.clipboard` API.

---

## File Map

**New:**
- `src/types/claude.ts` — `ClaudePrompt` interface
- `src/hooks/useCopyPrompt.ts` — clipboard write + 2s ✓ state
- `src/hooks/useCopyPrompt.test.ts` — hook tests
- `src/components/ClaudePromptPanel.tsx` — renders the sidebar section
- `src/components/ClaudePromptPanel.test.tsx` — component tests

**Modified:**
- `src/components/scope/StatusStrip.tsx` — add optional `prompts` prop, render panel at bottom
- `src/pages/ProjectScopeView.tsx` — define 4 prompts, pass to StatusStrip
- `src/pages/Inbox.tsx` — add 200px right panel (visible when brief selected), define 1 prompt
- `src/pages/ServiceDetail.tsx` — add Claude panel to page header right, define 1 prompt
- `src/pages/ProjectBuilder.tsx` — add Claude panel to left aside bottom, define 2 prompts
- `src/components/dashboard/OpsOverview.tsx` — add Claude panel below metrics cards, define 1 prompt
- `src/pages/ReconciliationView.tsx` — add Claude panel to page header right, define 2 prompts
- `src/pages/ProjectDetail.tsx` — add Claude panel below burn chart, define 2 prompts (retainer-conditional)

---

## Task 1: ClaudePrompt type

**Files:**
- Create: `src/types/claude.ts`

- [ ] **Step 1: Create the type file**

```ts
// src/types/claude.ts
export interface ClaudePrompt {
  id: string;
  label: string;
  build: () => string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/claude.ts
git commit -m "feat(claude-export): add ClaudePrompt type"
```

---

## Task 2: useCopyPrompt hook

**Files:**
- Create: `src/hooks/useCopyPrompt.ts`
- Create: `src/hooks/useCopyPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useCopyPrompt.test.ts
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useCopyPrompt } from "./useCopyPrompt";

describe("useCopyPrompt", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with copiedId null", () => {
    const { result } = renderHook(() => useCopyPrompt());
    expect(result.current.copiedId).toBeNull();
  });

  it("sets copiedId on copy", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    expect(result.current.copiedId).toBe("prompt-a");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("resets copiedId to null after 2000ms", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    expect(result.current.copiedId).toBe("prompt-a");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it("replaces copiedId when copy called again before reset", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    await act(async () => {
      result.current.copy("prompt-b", "world");
    });
    expect(result.current.copiedId).toBe("prompt-b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useCopyPrompt.test.ts
```

Expected: FAIL — `useCopyPrompt` not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useCopyPrompt.ts
import { useCallback, useRef, useState } from "react";

export function useCopyPrompt() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCopiedId(id);
      timerRef.current = setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  return { copy, copiedId };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/useCopyPrompt.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCopyPrompt.ts src/hooks/useCopyPrompt.test.ts
git commit -m "feat(claude-export): add useCopyPrompt hook"
```

---

## Task 3: ClaudePromptPanel component

**Files:**
- Create: `src/components/ClaudePromptPanel.tsx`
- Create: `src/components/ClaudePromptPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ClaudePromptPanel.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ClaudePromptPanel } from "./ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";

const prompts: ClaudePrompt[] = [
  { id: "sow", label: "Draft SoW", build: () => "sow prompt text" },
  { id: "update", label: "Client update", build: () => "update prompt text" },
];

describe("ClaudePromptPanel", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    });
  });

  it("renders section header", () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("renders a row for each prompt", () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    expect(screen.getByText("Draft SoW")).toBeInTheDocument();
    expect(screen.getByText("Client update")).toBeInTheDocument();
  });

  it("calls clipboard with built prompt on click", async () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    fireEvent.click(screen.getByTitle("Draft SoW"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("sow prompt text");
    });
  });

  it("renders nothing when prompts array is empty", () => {
    const { container } = render(<ClaudePromptPanel prompts={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/ClaudePromptPanel.test.tsx
```

Expected: FAIL — `ClaudePromptPanel` not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/ClaudePromptPanel.tsx
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyPrompt } from "@/hooks/useCopyPrompt";
import type { ClaudePrompt } from "@/types/claude";

interface Props {
  prompts: ClaudePrompt[];
}

export function ClaudePromptPanel({ prompts }: Props) {
  const { copy, copiedId } = useCopyPrompt();

  if (prompts.length === 0) return null;

  return (
    <section className="border-t border-m-outline-variant px-5 py-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-m-on-surface-variant">
        Claude
      </p>
      <div className="flex flex-col gap-0.5">
        {prompts.map((p) => (
          <button
            key={p.id}
            title={p.label}
            onClick={() => copy(p.id, p.build())}
            className={cn(
              "flex items-center gap-2 rounded px-1 py-1.5 text-left text-[12px] text-m-on-surface transition-colors",
              "hover:bg-m-primary-container hover:text-m-on-primary-container"
            )}
          >
            {copiedId === p.id ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-m-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 text-m-on-surface-variant" />
            )}
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/ClaudePromptPanel.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ClaudePromptPanel.tsx src/components/ClaudePromptPanel.test.tsx
git commit -m "feat(claude-export): add ClaudePromptPanel component"
```

---

## Task 4: ProjectScopeView — 4 prompts

**Files:**
- Modify: `src/components/scope/StatusStrip.tsx` — add optional `prompts` prop
- Modify: `src/pages/ProjectScopeView.tsx` — define and pass 4 prompts

- [ ] **Step 1: Add `prompts` prop to StatusStrip**

Open `src/components/scope/StatusStrip.tsx`. Change the Props interface and add the panel at the bottom of the `<aside>`:

```tsx
// Add import at top:
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";

// Change Props:
interface Props {
  actuals: ActualRow[];
  quote?: Quote | null;
  briefCount: number;
  prompts?: ClaudePrompt[];
}

// Change function signature:
export function StatusStrip({ actuals, quote, briefCount, prompts = [] }: Props) {
```

Add `<ClaudePromptPanel prompts={prompts} />` as the last child inside the `<aside>`, after the `{quote && (...)}` section:

```tsx
  {/* existing quote section */}
  {quote && (
    <section>...</section>
  )}

  <ClaudePromptPanel prompts={prompts} />
</aside>
```

- [ ] **Step 2: Define prompts in ProjectScopeView and pass them**

Open `src/pages/ProjectScopeView.tsx`. Add import:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

After the existing derived variables (after `const clientName = ...`), add:

```tsx
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;

const totalUsed = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);

const latestBrief = briefEvents[briefEvents.length - 1];
const latestBriefSummary = latestBrief?.type === "brief"
  ? `Subject: ${latestBrief.brief.raw_subject ?? "(no subject)"}\nFrom: ${latestBrief.brief.sender_email ?? ""}\nNotes: ${latestBrief.brief.am_notes ?? "(none)"}`
  : "(none)";

const quoteServices = activeQuote
  ? `Quote total: R${((activeQuote.total_cents ?? 0) / 100).toFixed(2)}\nQuote status: ${activeQuote.status}`
  : "No quote linked";

const recentActivity = events
  .slice(-3)
  .map((e) => {
    if (e.type === "brief") return `Brief: ${e.brief.raw_subject ?? "(no subject)"}`;
    if (e.type === "quote") return `Quote: ${e.quote.status}`;
    return e.type;
  })
  .join("\n");

const scopePrompts: ClaudePrompt[] = [
  {
    id: "draft-sow",
    label: "Draft SoW",
    build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Linked briefs: ${linkedBriefCount}
Latest brief:
${latestBriefSummary}

${MCP_NOTE}

Action: Run /sow new-project to generate a scope of work for this project. Use the client name and project name to look up relevant briefs via list-briefs and get-brief. Use the engagement type and quote context to inform scope tier and deliverables.

Output: A complete scope of work document ready for client review, formatted as markdown.`,
  },
  {
    id: "client-update",
    label: "Client update",
    build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
Scope status: ${scopeStatus.replace(/_/g, " ")}
Hours used: ${totalUsed}h of ${totalPlanned}h planned
Linked briefs: ${linkedBriefCount}
Recent activity:
${recentActivity || "(none)"}

${MCP_NOTE}

Action: Draft a concise, professional client-facing status update email for this project. Use the scope status, hours burned, and recent activity as the basis. Tone should be confident and transparent.

Output: A ready-to-send email with subject line and body. No placeholders.`,
  },
  {
    id: "brief-tasks",
    label: "Brief tasks",
    build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Latest brief:
${latestBriefSummary}

${MCP_NOTE}

Action: Run /brief to issue ClickUp tasks for the deliverables in the latest brief. Look up the client via find-client to get the client ID. Use the brief subject and notes to infer task names, descriptions, and assignees. Engagement type is "${engagementType}".

Output: Confirmation of tasks created in ClickUp with task IDs.`,
  },
  ...(linkedBriefCount > 0
    ? [
        {
          id: "scope-amendment",
          label: "Scope amendment",
          build: () => `${ROLE}

Context:
Client: ${clientName}
Project: ${projectName}
Engagement type: ${engagementType}
${quoteServices}
Latest brief (change request):
${latestBriefSummary}

${MCP_NOTE}

Action: Run /sow edit to produce an amended scope of work incorporating the change request in the latest brief. Include a change log section listing what was added, removed, or modified. Preserve the original scope structure.

Output: An updated scope of work document with a "Change log" section appended.`,
        } as ClaudePrompt,
      ]
    : []),
];
```

Then update the `<StatusStrip>` JSX to pass the prompts:

```tsx
<StatusStrip
  actuals={actuals}
  quote={activeQuote}
  briefCount={linkedBriefCount}
  prompts={scopePrompts}
/>
```

- [ ] **Step 3: Run the full test suite to check nothing broke**

```bash
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/scope/StatusStrip.tsx src/pages/ProjectScopeView.tsx
git commit -m "feat(claude-export): add 4 prompts to ProjectScopeView sidebar"
```

---

## Task 5: Inbox — 1 prompt

**Files:**
- Modify: `src/pages/Inbox.tsx` — add 200px right panel when brief is selected, define 1 prompt

- [ ] **Step 1: Add imports and right panel**

Open `src/pages/Inbox.tsx`. Add imports:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

The current layout is `<div className="flex h-full">`. Change it to a 3-column flex, adding a right panel that appears when `selectedBrief` is set. Add after the existing imports (before the component body):

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;
```

Inside the component, after the `filterOptions` and `filterLabel` derivations, add:

```tsx
const inboxPrompts: ClaudePrompt[] = selectedBrief
  ? [
      {
        id: "brief-from-email",
        label: "Brief from email",
        build: () => `${ROLE}

Context:
Subject: ${selectedBrief.raw_subject ?? "(no subject)"}
From: ${selectedBrief.sender_email ?? "(unknown)"}
Notes: ${selectedBrief.am_notes ?? "(none)"}
Brief ID: ${selectedBrief.id}

${MCP_NOTE}

Action: Run /intake or /brief using the email thread above as context. Look up the client via find-client using the sender email or client name. Create or update a brief in cc-service-calculator with the relevant context, classify the intent, and generate a scope or draft reply as appropriate.

Output: Confirmation of brief created or updated, with intent classification and any generated scope lines or draft reply.`,
      },
    ]
  : [];
```

Change the outer `<div className="flex h-full">` return to add the right panel:

```tsx
return (
  <div className="flex h-full">
    {/* Filter panel */}
    {filterTree && (
      <InboxFilterPanel
        tree={filterTree}
        activeClientId={activeClientId}
        activeContactEmail={activeContactEmail}
        onSelectAll={handleSelectAll}
        onSelectClient={handleSelectClient}
        onSelectContact={handleSelectContact}
        onSelectUnassigned={handleSelectUnassigned}
      />
    )}

    {/* Main content */}
    <div className="min-w-0 flex-1 overflow-y-auto p-6">
      {/* ...existing content unchanged... */}
    </div>

    {/* Claude panel — only when a brief is selected */}
    {selectedBrief && (
      <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface overflow-y-auto">
        <ClaudePromptPanel prompts={inboxPrompts} />
      </aside>
    )}
  </div>
);
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Inbox.tsx
git commit -m "feat(claude-export): add brief-from-email prompt to Inbox"
```

---

## Task 6: ServiceDetail — 1 prompt

**Files:**
- Modify: `src/pages/ServiceDetail.tsx` — add Claude panel to page layout, define 1 prompt

- [ ] **Step 1: Add imports**

Open `src/pages/ServiceDetail.tsx`. Add:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

- [ ] **Step 2: Define the prompt and add the panel**

Inside the `ServiceDetail` component, after the `form` state is set up, add:

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const servicePrompts: ClaudePrompt[] = mode === "edit" && form.name
  ? [
      {
        id: "process-steps",
        label: "Process steps",
        build: () => `${ROLE}

Context:
Service name: ${form.name}
Pricing model: ${form.pricing_model}
Unit of sale: ${form.unit_of_sale || "(not set)"}
Scope definition: ${form.scope_definition || "(not set)"}
Trigger to start: ${form.trigger_to_start || "(not set)"}
Completion definition: ${form.completion_definition || "(not set)"}
Default due days: ${form.default_due_days ?? "(not set)"}

${MCP_NOTE}

Action: Generate a numbered process step list (5–10 steps) for delivering this service. Each step should include: step number, action title, responsible role, estimated time, and done-when criteria. Steps should flow from client briefing through to delivery sign-off.

Output: A numbered markdown list of process steps, suitable for pasting into the service record's process_steps field.`,
      },
    ]
  : [];
```

`ServiceDetail` renders a full-page form. Find the outermost return div (the page wrapper) and wrap the existing content with a flex layout, adding a narrow right panel:

The current structure is approximately:
```tsx
return (
  <div className="...page wrapper...">
    <div className="...header...">...</div>
    <div className="...main content grid...">...</div>
  </div>
);
```

Change to:
```tsx
return (
  <div className="flex h-full">
    <div className="min-w-0 flex-1 overflow-auto">
      {/* existing page wrapper content here, unchanged */}
    </div>
    <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface">
      <ClaudePromptPanel prompts={servicePrompts} />
    </aside>
  </div>
);
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ServiceDetail.tsx
git commit -m "feat(claude-export): add process-steps prompt to ServiceDetail"
```

---

## Task 7: ProjectBuilder — 2 prompts

**Files:**
- Modify: `src/pages/ProjectBuilder.tsx` — add Claude panel to left aside bottom, define 2 prompts

- [ ] **Step 1: Add imports**

Open `src/pages/ProjectBuilder.tsx`. Add:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

- [ ] **Step 2: Define prompts inside the component**

After `const qb = useQuoteBuilder(briefId);` and the early return, add:

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const focusedService = qb.lines.length > 0
  ? qb.services?.find((s) => s.id === qb.lines[qb.lines.length - 1].service_id)
  : null;

const scopeText = [
  qb.scope?.enhanced_prose ? `Scope: ${qb.scope.enhanced_prose}` : "",
  qb.scope?.in_scope_md ? `In scope:\n${qb.scope.in_scope_md}` : "",
  qb.scope?.out_of_scope_md ? `Out of scope:\n${qb.scope.out_of_scope_md}` : "",
]
  .filter(Boolean)
  .join("\n\n");

const builderPrompts: ClaudePrompt[] = [
  ...(focusedService
    ? [
        {
          id: "process-steps",
          label: "Process steps",
          build: () => `${ROLE}

Context:
Service name: ${focusedService.name}
Pricing model: ${focusedService.pricing_model}
Unit of sale: ${focusedService.unit_of_sale ?? "(not set)"}
Scope definition: ${focusedService.scope_definition ?? "(not set)"}

${MCP_NOTE}

Action: Generate a numbered process step list (5–10 steps) for delivering this service. Each step should include: step number, action title, responsible role, estimated time, and done-when criteria.

Output: A numbered markdown list of process steps.`,
        } as ClaudePrompt,
      ]
    : []),
  {
    id: "quote-from-brief",
    label: "Quote from brief",
    build: () => `${ROLE}

Context:
Client: ${qb.clientName ?? "(unknown)"}
Brief subject: ${qb.brief?.raw_subject ?? "(untitled)"}
Brief notes: ${qb.brief?.am_notes ?? "(none)"}
${scopeText}
Current lines: ${qb.lines.length} services added

${MCP_NOTE}

Action: Review the brief and scope above and suggest a service line-up and allocation split to complete this quote. Use get-brief to retrieve full brief details if needed. For each suggested service, provide: service name, rationale, estimated hours, and recommended team allocation percentages.

Output: A structured list of suggested services with hours and allocation, ready to copy into the quote builder.`,
  },
];
```

- [ ] **Step 3: Add the panel to the left aside**

In the JSX, find the `<aside>` that contains `ScopeSidebar`, `RecurrencePanel`, and `SOWPanel`. Add `<ClaudePromptPanel>` as the last child inside it:

```tsx
<aside className="flex min-h-0 flex-col gap-6 overflow-auto pb-6">
  <ScopeSidebar ... />
  <div className="border-t border-m-outline-variant pt-6">
    <RecurrencePanel ... />
  </div>
  <div className="border-t border-m-outline-variant pt-6">
    <SOWPanel ... />
  </div>
  {/* Add this: */}
  <div className="border-t border-m-outline-variant pt-6">
    <ClaudePromptPanel prompts={builderPrompts} />
  </div>
</aside>
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectBuilder.tsx
git commit -m "feat(claude-export): add process-steps and quote-from-brief prompts to ProjectBuilder"
```

---

## Task 8: OpsOverview — 1 prompt

**Files:**
- Modify: `src/components/dashboard/OpsOverview.tsx` — add Claude panel below metrics, define 1 prompt

- [ ] **Step 1: Add imports**

Open `src/components/dashboard/OpsOverview.tsx`. Add:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

- [ ] **Step 2: Define the health narrative prompt**

Inside the `OpsOverview` component (which receives `opsData`, `monthlyHours`, `deliveryRate`, `dftCycleTime` as props), add before the return:

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const projectSummary = opsData.projects
  .map(
    (p) =>
      `- ${p.clientName} / ${p.name} [${p.engagementType}]: ${p.scopeStatus.replace(/_/g, " ")}${p.reasonText ? ` — ${p.reasonText}` : ""}`
  )
  .join("\n");

const opsPrompts: ClaudePrompt[] = [
  {
    id: "health-narrative",
    label: "Health narrative",
    build: () => `${ROLE}

Context:
Date: ${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
Monthly hours burned: ${monthlyHours ?? "(loading)"}h
Delivery rate: ${deliveryRate ? `${deliveryRate.rate}%` : "(loading)"}
Avg DFT cycle time: ${dftCycleTime ? `${dftCycleTime.days} days` : "(loading)"}

Projects:
${projectSummary || "(none)"}

${MCP_NOTE}

Action: Write a plain-English weekly ops summary suitable for a team standup or internal report. Cover: overall capacity health, projects needing attention, delivery performance, and 1–2 recommended actions. Keep it under 300 words.

Output: A formatted weekly ops summary in markdown, with sections: Overview, Projects Needing Attention, Performance Metrics, Recommended Actions.`,
  },
];
```

- [ ] **Step 3: Add the panel to the component's JSX**

Find the return statement in `OpsOverview`. Add `<ClaudePromptPanel>` as the last element before the closing wrapper, after the projects list:

```tsx
{/* existing project rows */}
{opsData.projects.map((p) => (
  <OpsProjectRow key={p.id} project={p} onSelect={onSelect} />
))}

{/* Add this at the bottom: */}
<div className="mt-4 border-t border-m-outline-variant pt-2">
  <ClaudePromptPanel prompts={opsPrompts} />
</div>
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/OpsOverview.tsx
git commit -m "feat(claude-export): add health-narrative prompt to OpsOverview"
```

---

## Task 9: ReconciliationView — 2 prompts

**Files:**
- Modify: `src/pages/ReconciliationView.tsx` — add Claude panel to page layout, define 2 prompts

- [ ] **Step 1: Add imports**

Open `src/pages/ReconciliationView.tsx`. Add:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

- [ ] **Step 2: Define the 2 prompts**

Inside `ReconciliationView`, after `const { data: rows = [], isLoading } = useReconciliation(year, month);`, add:

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const monthLabel = formatMonthLabel(year, month);

const rowSummary = rows
  .map(
    (r) =>
      `- ${r.clientName}: ${r.deliveredHours}h delivered, invoiced R${(r.invoicedCents / 100).toFixed(2)}, cost R${(r.costCents / 100).toFixed(2)}${r.flags.length ? `, flags: ${r.flags.join(", ")}` : ""}`
  )
  .join("\n");

const reconPrompts: ClaudePrompt[] = [
  {
    id: "recon-explanation",
    label: "Recon explanation",
    build: () => `${ROLE}

Context:
Month: ${monthLabel}
Reconciliation data:
${rowSummary || "(no data)"}

${MCP_NOTE}

Action: Write a plain-English reconciliation explanation for ${monthLabel}. For each client with flags or notable variances, explain what happened and why (e.g. work not invoiced, invoice overdue, cost vs invoiced gap). Keep each client explanation to 2–3 sentences. Suitable for an internal debrief or client conversation.

Output: A markdown report with one section per flagged client, plus a one-paragraph overall summary.`,
  },
  {
    id: "invoice-line-items",
    label: "Invoice line items",
    build: () => `${ROLE}

Context:
Month: ${monthLabel}
Billable hours by client:
${rowSummary || "(no data)"}

${MCP_NOTE}

Action: Format the billable hours above as Xero-ready invoice line item descriptions for ${monthLabel}. For each client, produce: description (service type + period), quantity (hours), unit (hours), and amount note. Use professional billing language.

Output: A markdown table with columns: Client | Description | Hours | Notes. One row per client with delivered hours > 0.`,
  },
];
```

- [ ] **Step 3: Add the panel to the layout**

`ReconciliationView` currently renders a full-width page. Wrap the existing return in a flex layout with a right panel:

```tsx
return (
  <div className="flex h-full">
    <div className="min-w-0 flex-1 overflow-auto">
      {/* existing page content — header, month nav, table — unchanged */}
    </div>
    <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface">
      <ClaudePromptPanel prompts={reconPrompts} />
    </aside>
  </div>
);
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ReconciliationView.tsx
git commit -m "feat(claude-export): add recon-explanation and invoice prompts to ReconciliationView"
```

---

## Task 10: ProjectDetail — 2 prompts (retainer-conditional)

**Files:**
- Modify: `src/pages/ProjectDetail.tsx` — add Claude panel, define 2 prompts

- [ ] **Step 1: Add imports**

Open `src/pages/ProjectDetail.tsx`. Add:

```tsx
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";
```

- [ ] **Step 2: Define the prompts**

Inside `ProjectDetail`, after `const { data } = useProject(id);`, add:

```tsx
const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
const MCP_NOTE = `You have access to the cc-calculator MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

const project = data?.project;
const actuals = data?.actuals ?? [];

const totalUsed = actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0);
const totalPlanned = actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0);
const engagementType = project?.engagement_type ?? "fixed";
const isRetainer = engagementType === "retainer";

const actualsSummary = actuals
  .map((a) => `  ${a.dept_id ?? "—"}: ${a.actual_hours ?? 0}h actual / ${a.planned_hours ?? 0}h planned`)
  .join("\n");

const projectPrompts: ClaudePrompt[] = [
  ...(isRetainer && project
    ? [
        {
          id: "retainer-review",
          label: "Retainer review",
          build: () => `${ROLE}

Context:
Project ID: ${project.id}
Engagement type: retainer
Retainer hours/month: ${project.retainer_hours_pm ?? "(not set)"}
Monthly fee: ${project.retainer_fee_cents != null ? `R${(project.retainer_fee_cents / 100).toFixed(2)}` : "(not set)"}
Hours used this period: ${totalUsed}h of ${totalPlanned}h planned
By department:
${actualsSummary || "  (no actuals)"}

${MCP_NOTE}

Action: Produce a retainer health summary and renewal recommendation. Cover: hours pacing (on track / over / under), value delivered vs fee, and a recommended action (renew as-is, adjust hours, or flag for discussion). Keep it under 200 words.

Output: A short markdown report with sections: Pacing, Value Assessment, Recommendation.`,
        } as ClaudePrompt,
      ]
    : []),
  ...(project
    ? [
        {
          id: "invoice-line-items",
          label: "Invoice line items",
          build: () => `${ROLE}

Context:
Project ID: ${project.id}
Engagement type: ${engagementType}
Hours delivered this period: ${totalUsed}h
By department:
${actualsSummary || "  (no actuals)"}

${MCP_NOTE}

Action: Format the hours above as Xero-ready invoice line item descriptions. For each department with actual hours > 0, produce: description (department + service type + period), quantity (hours), and amount note. Use professional billing language.

Output: A markdown table with columns: Department | Description | Hours | Notes.`,
        } as ClaudePrompt,
      ]
    : []),
];
```

- [ ] **Step 3: Add the panel to the layout**

Find where `<BurnChart>` is rendered in the JSX. Add the panel after it:

```tsx
<BurnChart ... />

<div className="mt-4">
  <ClaudePromptPanel prompts={projectPrompts} />
</div>
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectDetail.tsx
git commit -m "feat(claude-export): add retainer-review and invoice prompts to ProjectDetail"
```

---

## Task 11: Smoke test in the browser

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open http://localhost:5174 and sign in as `team@convertedclick.co.za` / `cc-calc-2026-temp`.

- [ ] **Step 2: Check each page**

For each page, verify:
- The "Claude" section header appears
- Each expected prompt label is shown
- Clicking a label copies text to clipboard (paste into a text editor to confirm)
- The icon flips to ✓ and reverts after ~2 seconds

| Page | Expected prompts |
|---|---|
| ProjectScopeView (any project) | Draft SoW · Client update · Brief tasks · (Scope amendment if briefs linked) |
| Inbox (brief selected) | Brief from email (right panel appears) |
| ServiceDetail (edit mode) | Process steps |
| ProjectBuilder | Process steps (if lines added) · Quote from brief |
| Dashboard | Health narrative |
| Reconciliation | Recon explanation · Invoice line items |
| ProjectDetail (retainer) | Retainer review · Invoice line items |
| ProjectDetail (fixed) | Invoice line items only |

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix(claude-export): browser smoke test fixups"
```
