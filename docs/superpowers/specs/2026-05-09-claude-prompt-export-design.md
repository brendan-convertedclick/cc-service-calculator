# Claude Prompt Export — Design Spec

**Date:** 2026-05-09
**Status:** Approved

## Overview

A lightweight "copy to clipboard" mechanism that lets the operations manager export a pre-built, context-rich prompt from any relevant page in the app. The prompt is pasted into Claude Code, which uses the `cc-calculator` MCP to do the work — avoiding direct Anthropic API calls from the browser.

No AI runs in the app. The app's job is to assemble the prompt; Claude Code's job is to execute it.

---

## UI Pattern

### Placement
A "Claude" section at the bottom of the right-hand sidebar on every applicable page. Sits below existing sidebar content (status, hours, etc.).

### Interaction
- Each prompt is a single row: **copy icon (14px) + short label (12px)**
- Hovering the row highlights it in `bg-m-primary-container` tones
- Clicking writes the prompt to clipboard; the copy icon flips to a ✓ for 2 seconds then reverts
- No modal, no toast, no navigation — just silent clipboard copy

### Section header
```
CLAUDE                          ← 10px uppercase label, color: m-on-surface-variant
[ ] Draft SoW
[ ] Client update
[ ] Brief tasks
```

---

## Shared Components

### `src/types/claude.ts`
```ts
export interface ClaudePrompt {
  id: string
  label: string
  build: () => string
}
```

### `src/hooks/useCopyPrompt.ts`
- State: `copiedId: string | null`
- `copy(id: string, text: string)` — writes to clipboard, sets `copiedId`, resets to `null` after 2000ms
- Returns `{ copy, copiedId }`

### `src/components/ClaudePromptPanel.tsx`
- Props: `prompts: ClaudePrompt[]`
- Renders the "Claude" section header + one row per prompt
- Uses `useCopyPrompt` internally
- Row renders copy icon when `copiedId !== prompt.id`, ✓ icon when it matches
- Tooltip (native `title` attribute) on each row showing the label

---

## Prompt Map

Each page defines its own `ClaudePrompt[]` inline, using data already available in component scope. The `build()` function is a closure over local variables — no prop drilling, no registry.

### ProjectScopeView — 4 prompts

**Draft SoW**
Uses: `clientName`, `projectName`, `engagementType`, `activeQuote` (services + line items), linked brief content (from brief events).
Prompt instructs Claude Code to run `/sow new-project` with the data pre-filled.

**Client update email**
Uses: `scopeStatus`, `project.hours_burned`, `project.hours_total`, `events` (last 3 activities), `linkedBriefCount`.
Prompt instructs Claude Code to draft a client-facing status email.

**Brief tasks**
Uses: `activeQuote` scope line items, `clientName`, `projectName`, `engagementType`.
Prompt instructs Claude Code to run `/brief` to issue ClickUp tasks for each deliverable.

**Scope amendment** *(conditional: only shown when `linkedBriefCount > 0`)*
Uses: current SoW content (from `activeQuote`), latest brief message thread.
Prompt instructs Claude Code to run `/sow edit` to produce an amended scope with change log.

---

### Inbox — 1 prompt

**Brief from email**
Uses: selected thread's subject, body, sender, and client name (looked up from the thread's from-address or manually associated).
Prompt instructs Claude Code to run `/intake` or `/brief` with the full email thread as context.

*Placement note:* Inbox has no right sidebar today. The Claude section is added as a new 200px right panel that appears when a thread is open, consistent with the sidebar pattern on other pages.

---

### ServiceDetail — 1 prompt

**Process steps**
Uses: `service.name`, `service.description`, `service.category`, `service.default_hours`.
Prompt instructs Claude Code to generate a numbered process step list and paste it back into the service record via MCP.

---

### ProjectBuilder — 2 prompts

**Process steps**
Uses: the currently selected/focused service in the builder (name, description, category).
Prompt is identical to the ServiceDetail version. Only shown when a service is focused.

**Quote from brief**
Uses: the brief content loaded in the builder (if a brief is linked), client name, engagement type.
Prompt instructs Claude Code to suggest a service line-up and allocation split to assemble the quote.

---

### OpsOverview / Dashboard — 1 prompt

**Health narrative**
Uses: all `OpsProject[]` rows — name, client, `scopeStatus`, `reasonText`, `engagementType` — plus aggregate metrics (monthly hours, delivery rate, DFT cycle time) from existing hooks.
Prompt instructs Claude Code to write a plain-English weekly ops summary suitable for a team standup or internal report.

---

### ReconciliationView — 2 prompts

**Reconciliation explanation**
Uses: actuals vs. quoted table rows (service, quoted hours, actual hours, variance).
Prompt instructs Claude Code to write a plain-English variance explanation for the client or internal debrief.

**Invoice line items**
Uses: all logged hours for the billing period broken down by service and team member.
Prompt instructs Claude Code to format them as Xero-ready invoice line descriptions.

---

### ProjectDetail (retainer projects only) — 2 prompts

**Retainer review**
Uses: `project.retainer_hours_pm`, current month's `hours_burned`, service mix from actuals.
Prompt instructs Claude Code to produce a retainer health summary and renewal recommendation.
*Only shown when `engagementType === 'retainer'`.*

**Invoice line items**
Same as ReconciliationView version. Uses monthly actuals for this project.

---

## Prompt Content Standard

Every exported prompt must include:

1. **Role line** — "You are the Converted Click operations assistant working in Claude Code."
2. **Context block** — all relevant data from the page, formatted as labelled fields (not JSON blobs).
3. **MCP note** — "You have access to the `cc-calculator` MCP tools: `find-client`, `get-active-projects`, `get-active-retainer`, `list-briefs`, `get-brief`, `create-brief`."
4. **Action instruction** — exactly what to do, referencing skills where applicable (`/sow`, `/brief`, `/intake`, `/log`).
5. **Output format** — what the ops manager should expect to see in return.

---

## What's Not In Scope

- Sending the prompt automatically to any API
- Storing prompt history
- User-configurable prompt templates
- Any prompt that requires data not already loaded on the current page

---

## Files To Create / Modify

**New:**
- `src/types/claude.ts`
- `src/hooks/useCopyPrompt.ts`
- `src/components/ClaudePromptPanel.tsx`

**Modified (add ClaudePromptPanel to sidebar):**
- `src/pages/ProjectScopeView.tsx`
- `src/pages/Inbox.tsx` (+ new right panel)
- `src/pages/ServiceDetail.tsx`
- `src/pages/ProjectBuilder.tsx`
- `src/components/dashboard/OpsOverview.tsx` — all aggregate metrics (opsData, monthlyHours, deliveryRate, dftCycleTime) are already props here
- `src/pages/ReconciliationView.tsx`
- `src/pages/ProjectDetail.tsx`
