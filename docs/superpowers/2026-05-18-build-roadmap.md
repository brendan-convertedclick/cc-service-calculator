# Build Roadmap — 2026-05-18

A working document. We list every section we want to build or rework, agree on what each one is, then sequence them. Each item eventually becomes its own design spec under `docs/superpowers/specs/` and an implementation plan.

**Two phases:**

1. **Planning (this doc)** — enumerate sections, one-line description, classify as `NEW` or `REWORK`, rough size (`S` / `M` / `L`).
2. **Execution** — walk the sequenced list top-to-bottom: for each, run `/brainstorm` → write spec → `/writing-plans` → implement.

---

## Current app surface (for reference)

Routes that exist today (from `src/App.tsx`):

- **Dashboard** — `/` (IDE-style standalone)
- **Inbox** — `/inbox`, `/inbox/:briefId`
- **Briefs** — `/briefs`, `/briefs/new`, `/briefs/:id`, `/briefs/:id/scope`, `/briefs/:id/builder`
- **Quotes** — `/quotes/:id`, `/quotes/:id/send`
- **Clients** — `/clients`, `/clients/:id`, `/clients/:clientId/projects/:projectId`
- **Projects** — `/projects`, `/projects/:id`
- **Productivity** — `/productivity` (with Tasks tab — By Person / By Task)
- **Pulse** — `/pulse`
- **Reconciliation** — `/reconciliation`
- **SOW** — `/sow/:familySlug`
- **Services** — `/services`, `/services/new`, `/services/:id`
- **Rules** — `/rules`
- **Departments** — `/departments`
- **Team** — `/team`
- **Settings** — `/settings`, `/settings/gmail`
- **Scaffold** — `/scaffold/live-tasks`, `/scaffold/foundations`, `/scaffold/invoice-preview`
- **Guides** — `/guides`

---

## The 8 phases

These are the build phases in the order we'll execute them. Each phase becomes its own design spec + implementation plan.

### Phase 1 — Staff-authored briefs

Today the **client intake** path covers briefs that arrive from clients (Gmail → Inbox → brief). This phase adds the **staff-authored brief** path: a member of the team starts a brief directly inside the app for work that doesn't originate from a client email. Same downstream pipeline (brief → scope → builder → quote), different entry point.

- Open questions: who can author? does it skip Inbox entirely? does it need a client+sender stub or just a client pick?
- Likely surface: new `/briefs/new` flow (or split modes), Briefs list filter for "internal-origin".

### Phase 2 — Extension requests

Staff submit **extension requests** against existing work — extra scope, deadline shifts, budget bumps. Needs to land somewhere reviewable and tie back to the original brief/project.

- Open questions: extension of *what* (brief, project, quote, sprint task)? Approval flow? Effect on quoted hours/budget?
- Likely surface: action on `ProjectDetail` / `BriefResume`, a queue view for review.

### Phase 3 — Project overview (success view)

A view per project that answers "**are we winning or losing on this?**" — the metrics that show whether the project is successful or not. Distinct from the existing scope/builder pages, which are about plan, not outcome.

- Candidate metrics: estimated vs actual hours, profitability, variance trend, milestone health, client-feedback signal, risk flags.
- Likely surface: a new tab on `ProjectDetail`, or upgrade of `ProjectScopeView`.

### Phase 4 — Scope of work

The **scope of work** itself — how it's built, displayed, edited, and presented to the client. Builds on existing `Scope.tsx` / `ProjectBuilder.tsx` / SOW pages.

- Open questions: what specifically is changing — authoring UX, client-facing presentation, both? How does it relate to the master/project SoW pattern in `wiki/sow/`?

### Phase 5 — Problem highlighting

The system surfaces **problems** — work going off-rails, blockers, overruns, stalled tasks, missed milestones — so they're obvious instead of buried.

- Open questions: where do problems live (Pulse? Dashboard? per-project?), what's the detection logic (rules vs AI), and what's the action on each problem (acknowledge / fix / escalate)?

### Phase 6 — Client feedback

How **client feedback** is captured, attached to work, and fed back into the success view (Phase 3) and problem detection (Phase 5).

- Open questions: source (email reply, Gmail thread mining, manual entry, in-app form for clients?), where it attaches (project, brief, milestone), tone/sentiment tagging.

### Phase 7 — Original plan items

Pull through the **outstanding items from the original V1 plan** at `~/.claude/plans/https-lpgwxacoqiqpcfpkklib-supabase-co-i-cuddly-puffin.md` that haven't been done yet. To-do during execution: read that plan, diff against the live app, list the gaps here.

- Action: when we hit this phase, do a gap pass and append the concrete items.

### Phase 8 — Full planning implementation

How we **implement the full planning workflow end-to-end** inside the app — i.e. the planning system itself becomes a first-class feature, not just a flow that happens across scattered pages. Likely ties together briefs → scope → builder → schedule → brief-out, with the planner as the primary surface.

- Open questions: is this a new top-level page, or a rework of Builder/Scope into one cohesive planner? Sprint-points / scheduler skill integration?

---

## Per-phase backlog (catch-all)

Smaller items that don't deserve their own phase but should ride along. Will be sorted into the relevant phase or a cross-cutting bucket as they come up.

- [ ] _add items here_

---

## Execution log

| Date | Item | Spec path | Plan path | Status |
| ---- | ---- | --------- | --------- | ------ |

---

## Open questions

- _add items here_
