# A Guide to the Service Calculator — for Lisa

This is the working manual for the Converted Click service calculator. It explains what each part of the system does, how the pieces connect, and what you do at each step. If anything here doesn't match what you're seeing in the app, the app is right — flag it and we'll update this doc.

---

## 1. High-level overview

The service calculator is the single place where a client conversation becomes a scoped, quoted, and tracked piece of work. It connects four outside systems together so we don't have to do that work in our heads.

```
                  ┌──────────────────────────────────────────────┐
                  │                  THE OUTSIDE                  │
                  │                                                │
                  │   Gmail        ClickUp        Xero      Figma  │
                  │   (intake)     (delivery)    (money)   (design)│
                  └──┬──────────────┬──────────────┬─────────┬─────┘
                     │              │              │         │
                     ▼              ▼              ▼         ▼
        ┌──────────────────────────────────────────────────────────┐
        │              SERVICE CALCULATOR (this app)                │
        │                                                            │
        │   ┌──────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐  │
        │   │  INBOX   │──▶│  SCOPE  │──▶│  QUOTE  │──▶│ PROJECT │  │
        │   │ (briefs) │   │ editor  │   │ builder │   │  track  │  │
        │   └──────────┘   └─────────┘   └─────────┘   └─────────┘  │
        │         │             │             │             │       │
        │         └─────────────┴──────┬──────┴─────────────┘       │
        │                              ▼                            │
        │              ┌───────────────────────────┐                │
        │              │   SUPABASE (the database) │                │
        │              │   briefs · scopes · quotes│                │
        │              │   projects · actuals      │                │
        │              │   services · clients      │                │
        │              └───────────────┬───────────┘                │
        │                              │                            │
        │              ┌───────────────┴───────────┐                │
        │              │   AI ASSIST (Claude)      │                │
        │              │   reads brief, drafts     │                │
        │              │   scope + estimate        │                │
        │              └───────────────────────────┘                │
        └──────────────────────────────────────────────────────────┘
                              ▲                ▲
                              │                │
                ┌─────────────┴──┐    ┌────────┴────────┐
                │ RECONCILIATION │    │  PULSE / OPS    │
                │ planned vs.    │    │  retainer health│
                │ actual hours   │    │  touchpoints    │
                └────────────────┘    └─────────────────┘
```

**What each block is for:**

- **Gmail → Inbox.** Every client email gets relayed in and lands in the Inbox as a brief.
- **Scope editor.** Where a free-form brief becomes a clean "in scope / out of scope / open questions" document.
- **Quote builder.** Where scope becomes line items, hours, allocations, and a price.
- **Project tracker.** Where an accepted quote becomes a live project in ClickUp, with planned hours.
- **Reconciliation & Pulse.** Where we see how we're doing — actual hours vs. plan, retainer burn-down, client touchpoints.
- **Supabase.** The single shared database. Every screen reads from and writes to this.
- **Claude AI.** Reads briefs in the background and proposes scope and rough estimates. It never sends anything to the client; you always approve.

---

## 2. How a message becomes a tracked project

This is the journey of one piece of work, from "we got an email" to "we know if we hit our number." Every box below is a status the brief / project moves through.

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Client sends email to brendan@convertedclick.co.za         │
   └────────────────────────────────┬────────────────────────────┘
                                    │  (Gmail relay)
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  brief created · status = NEW                                │
   │  AI reads it, classifies intent:                             │
   │    • new_brief           → goes to Scope                     │
   │    • project_thread      → attaches to existing project      │
   │    • retainer_thread     → attaches to active retainer       │
   │    • quick_response      → drafts a reply for you            │
   └────────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  AI auto-scope runs in background                            │
   │  → drafts in-scope · out-of-scope · open questions           │
   │  → status = TRIAGED (waiting for you)                        │
   └────────────────────────────────┬────────────────────────────┘
                                    │  you review & lock the scope
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  status = SCOPED                                             │
   │  Brief intelligence drafted: requirements, work breakdown,   │
   │  hours (low/mid/high), price estimate, AM approval gate      │
   └────────────────────────────────┬────────────────────────────┘
                                    │  you open the Project Builder
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Quote built from scope                                      │
   │  → pick services from catalog                                │
   │  → override hours / department allocations if needed         │
   │  → preview SOW HTML, totals, margin                          │
   │  → status = QUOTED  (or quote.status = sent)                 │
   └────────────────────────────────┬────────────────────────────┘
                                    │  client accepts
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Project created                                             │
   │  → parent task + child tasks pushed to ClickUp               │
   │  → planned hours stored per service per department           │
   │  → status = ACCEPTED → project status = IN_PROGRESS          │
   └────────────────────────────────┬────────────────────────────┘
                                    │  team logs time in ClickUp
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Hourly sync pulls ClickUp time entries                      │
   │  → project_actuals updated                                   │
   │  → Reconciliation shows planned vs. actual                   │
   │  → Pulse tracks retainer hours used vs. monthly target       │
   └────────────────────────────────┬────────────────────────────┘
                                    │  work finishes
                                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  status = COMPLETED                                          │
   │  Variance (over / under) feeds back into how we estimate     │
   │  the next brief of the same type.                            │
   └─────────────────────────────────────────────────────────────┘
```

Two things to notice on this diagram:

1. **The brief is never thrown away.** Every project has a brief behind it, and every brief keeps its full Gmail thread. You can always trace a line item back to "who asked for this, when, in what words."
2. **The AI is upstream of you, not downstream.** It drafts so you can edit — it doesn't decide. The "lock" step is where the scope becomes binding.

---

## 3. The sections, one by one

Each section below covers **what the page does**, **how to use it**, and **why it matters**. Pages are listed in roughly the order you'll touch them in a typical week.

### 3.1 Inbox  (`/inbox`)

**What it is.** The triage list of every brief that's come in by email or been created manually. Each row is one client conversation.

**How to use it.**
- Open Inbox in the morning. Anything `NEW` or `NEEDS_INFO` is waiting on you.
- Click a brief to see the full Gmail thread on the left and the AI's proposed scope on the right.
- Use the filter chips to narrow by assignee, client, or status.
- If a brief is spam or a duplicate, mark it `spam` or `archived` — don't leave it sitting in `new`.
- If something needs more info from the client, set it to `needs_info` and reply from the thread.

**Why it matters.** This is the only place where the team agrees on "what counts as work in flight." If a brief isn't in the Inbox, it's invisible to everyone else — including capacity planning. The status discipline (new → triaged → scoped) is what lets us see where the bottleneck is on any given day.

---

### 3.2 Scope editor  (`/briefs/:id/scope`)

**What it is.** A structured document for one brief: *in scope* bullets, *out of scope* bullets, *open questions*, and a prose summary. The AI drafts it; you edit and lock it.

**How to use it.**
- Read the AI's draft. Don't trust it blindly — the AI is good but it doesn't know the client like you do.
- Add anything missing to *in scope*. Move anything aspirational to *out of scope* — this is your protection from scope creep later.
- Write *open questions* as actual questions a client can answer in one line. These become the next email to the client.
- When you're happy, **lock** the scope. Locking is what unlocks the quote builder.

**Why it matters.** The scope is the contract before the contract. Every disagreement we've ever had with a client about "but I thought that was included" traces back to a scope that wasn't precise. Out-of-scope bullets are worth as much as in-scope ones.

---

### 3.3 Project Builder / Quote Builder  (`/briefs/:id/builder`)

**What it is.** Turns a locked scope into a priced quote. Pick services from the catalog, override hours and department splits if the standard numbers don't fit, see totals and margin update live.

**How to use it.**
- Start from the AI's suggested services. Add or remove until the line items match the scope bullets.
- For each service, check the default hours. If this client / job is unusual, override at the line level — don't change the catalog.
- Look at the margin row at the bottom *before* you send. Anything below the floor needs a conversation, not a quote.
- Click **Generate SOW** to preview the document the client will see, then send.

**Why it matters.** This is where time and money get committed. The hours you put here become the planned hours that everything downstream (Reconciliation, Pulse, profitability) compares against. Sloppy estimates here cause every downstream report to lie.

---

### 3.4 Quote detail & send  (`/quotes/:id`, `/quotes/:id/send`)

**What it is.** The read-only view of a generated quote, plus the form for sending it to the client and capturing acceptance.

**How to use it.**
- Review the SOW HTML before sending. The client sees what you see.
- Send sets the status to `sent` and timestamps it.
- When the client accepts (email, signed PDF, verbal — whatever), record it here. This is what creates the project.

**Why it matters.** "Accepted" is not a vibe — it's a row in the database with a date on it. That timestamp is how we measure quote-to-start cycle time and how Xero knows to issue the invoice.

---

### 3.5 Projects list & detail  (`/projects`, `/projects/:id`)

**What it is.** Every project the team is delivering. The list shows status, client, value, and progress. The detail page links back to the brief, the quote, and the live ClickUp parent task.

**How to use it.**
- Use the list as your "what's the team working on" view.
- Open a detail page to see planned hours per service vs. what's been logged so far.
- If a project is stuck, move it to `cancelled` rather than leaving it `in_progress` forever — silent zombies skew capacity numbers.

**Why it matters.** Projects are the unit we plan capacity against. If the list is honest, planning is easy. If it's full of stale rows, planning is fiction.

---

### 3.6 Reconciliation  (`/reconciliation`)

**What it is.** The truth-telling page. For every active project, planned hours vs. actual hours, broken down by department. Pulls from ClickUp once an hour.

**How to use it.**
- Once a week, walk down the list and look for projects burning hot (actuals above plan) or cold (no time logged in days).
- Hot projects → either the scope was wrong or someone's logging time against the wrong task. Investigate before it eats the margin.
- Cold projects → either nobody's working on it (problem) or people are working but not logging (bigger problem).

**Why it matters.** This is the only place that closes the loop between what we promised and what we actually did. Without reconciliation, the quote builder's estimates never get better.

---

### 3.7 Pulse  (`/pulse`)

**What it is.** Retainer health. Shows hours used vs. monthly target for each retainer client, plus a log of client touchpoints (calls, meetings, emails worth flagging).

**How to use it.**
- Friday afternoon, scan Pulse for retainers near 100% with weeks left in the month — that's a conversation to have *before* you overspend.
- Log touchpoints as they happen — a 15-minute call you forgot to log is a 15-minute call you didn't bill.

**Why it matters.** Retainers die quietly. Either we burn through the hours and feel resentful, or we don't burn through them and the client feels they're not getting value. Pulse makes both visible.

---

### 3.8 Clients  (`/clients`)

**What it is.** The client directory. Each row links to the client's Xero contact, ClickUp folder, and (where set up) Obsidian wiki page.

**How to use it.**
- Open a client to see their full history of briefs and projects.
- When onboarding a new client, this is where you confirm the Xero contact and ClickUp folder were created.
- Archive clients you haven't worked with in 12+ months — they clutter dropdowns elsewhere.

**Why it matters.** Clients are the spine the rest of the data hangs off. If a brief gets attached to the wrong client (or to no client), every downstream report becomes useless for that revenue.

---

### 3.9 Services catalog  (`/services`, `/services/:id`)

**What it is.** The master list of things we sell. Each service has a price, a pricing model (hourly / fixed / percentage), a default set of process steps, and a default split across departments.

**How to use it.**
- Treat the catalog like a recipe book. Edits here affect every future quote, so go slowly.
- Adding a new service: use **Generate process steps** to get an AI draft, then refine. Set the department allocation rule before publishing.
- If a service is being retired, mark it `archived` rather than deleting — old quotes still reference it.

**Why it matters.** Consistent catalog → consistent quotes → consistent margins. The catalog is what makes us look like one company rather than a collection of freelancers.

---

### 3.10 Rules & Departments  (`/rules`, `/departments`)

**What it is.** Rules are reusable percentage splits (e.g. "this kind of work is 60% dev, 30% design, 10% PM"). Departments are the buckets those percentages go into, with their own hourly and cost rates.

**How to use it.**
- Mostly leave these alone day-to-day.
- Touch them when: a rate changes, a new department spins up, or a recurring service is misallocated.

**Why it matters.** These are the rails the quote builder runs on. Bad rates here = bad quotes everywhere.

---

### 3.11 Team  (`/team`)

**What it is.** Roster of team members, their primary department, cost rates, and skills.

**How to use it.**
- Keep cost rates current — they're what margin is calculated against.
- Add new team members on day one so their time logs land in the right department.

---

### 3.12 SOW templates  (`/sow/:familySlug`)

**What it is.** Master Statement of Work templates with reusable clauses and pricing tiers.

**How to use it.**
- When the boilerplate in a quote needs to change (e.g. legal updates, payment terms), change it here, not in the quote.
- Each family can have levels (silver / gold / platinum etc.) for tiered offerings.

**Why it matters.** Quote SOWs render from these templates, so a change here is a change everywhere — fast and consistent.

---

### 3.13 Settings & Gmail connection  (`/settings`, `/settings/gmail`)

**What it is.** Where the app connects to Xero, ClickUp, and Gmail.

**How to use it.**
- **Gmail:** issue a relay token, paste it into the Apps Script, and emails will start flowing into the Inbox.
- **Xero / ClickUp:** OAuth or PAT-based — set once, then forget unless tokens expire.

**Why it matters.** Without these connections, the app is an island. With them, it's the hub the whole agency runs through.

---

### 3.14 Dashboard  (`/`) and Guides  (`/guides`)

**Dashboard** is a workspace-style overview — open it when you want a single-pane view of the day.
**Guides** holds the style guide and any internal docs (this file may live there).

---

## 4. What's not in the system, and what I'd add next

These are honest gaps. None of them block today's work, but each one would pay back the time spent building it.

### 4.1 Per-user accountability (HIGH value)

**The gap.** We sign in as `team@convertedclick.co.za`. The app knows it's "someone from the team" but not which someone. Created-by and triaged-by fields are mostly null.

**Why add it.** When a brief is mis-scoped or a project goes sideways, we can't tell who touched what. Auditability also matters once we start onboarding more people. Even lightweight per-user logins (no role permissions yet, just identity) would unlock weekly "what did each person move" reports.

### 4.2 Notifications (HIGH value)

**The gap.** Nothing notifies you. You have to remember to check the Inbox and Reconciliation.

**Why add it.** A daily morning digest (new briefs, retainers near cap, projects with no time logged in 5+ days) by email or Slack would replace at least one standing meeting. Cheap to build, very high signal.

### 4.3 Win/loss tracking on quotes (MEDIUM value)

**The gap.** We capture *accepted* and *rejected*, but not *why*. Rejections vanish into the archive.

**Why add it.** A short structured reason field (price, timing, lost to competitor, never replied) on rejection, plus a quarterly view of patterns, tells us whether we're being too expensive or too slow. Right now we're guessing.

### 4.4 Forecast / pipeline view (MEDIUM value)

**The gap.** We see what's *in progress*, not what's *likely to come in*. Briefs that are scoped but not yet quoted, or quoted but not yet accepted, don't roll up anywhere.

**Why add it.** A weighted pipeline view (e.g. quoted × 50%, scoped × 25%) would turn the Inbox into a forecast. Useful for capacity planning and cashflow modelling.

### 4.5 Search across briefs and projects (MEDIUM value)

**The gap.** No global search. To find "that thing we did for client X about Y last year" you have to remember the client and scroll.

**Why add it.** Full-text search across briefs, scopes, and quotes would make the system act as institutional memory, not just a workflow tool. Especially valuable as the archive grows past a couple of hundred briefs.

### 4.6 Quick-reply templates in the Inbox (LOW-MEDIUM value)

**The gap.** The AI drafts a single reply for "quick_response" intents, but there are no reusable templates for common situations ("thanks, we'll have a scope to you Friday").

**Why add it.** Reduces the cognitive load of triage and keeps tone consistent across the team. A handful of templates would cover 70% of replies.

### 4.7 Margin/profitability rollup (LOW-MEDIUM value)

**The gap.** We see planned margin on a quote and actual hours on Reconciliation, but no page does the multiplication — "this project earned us £X after costs."

**Why add it.** Closes the financial loop. Lets us answer "which services are actually profitable?" rather than "which services do we sell most?"

### 4.8 Mobile-friendly Inbox (LOW value)

**The gap.** The app assumes a laptop. The Inbox in particular is hard to triage on a phone.

**Why add it.** Triage often happens in spare moments. A read-and-tag-only mobile view (no quote building) would save the laptop session for the actual scoping work.

### 4.9 Client-facing read-only view (LOW value, big optics)

**The gap.** Clients see emails and PDFs from us. They never see the live state of their project.

**Why add it.** A scoped read-only project page (planned hours used, next milestones, open questions) shared with the client would reduce "where are we?" emails dramatically. It's also a strong differentiator at sales time.

### 4.10 Onboarding tour for new team members (LOW value)

**The gap.** No in-app guidance. New starters learn by shadowing.

**Why add it.** Even simple tooltips on first visit ("this is where you lock a scope") would shrink the time-to-useful for new joiners from weeks to days.

---

## 5. Where to ask questions

- **Anything broken or confusing in the app:** message Brendan directly.
- **Anything the doc gets wrong:** edit this file — it lives at `docs/lisa-guide.md` and is checked into the repo with the rest of the project.
- **Anything that should be a feature:** drop it into the Inbox as a brief addressed to Converted Click. We dogfood our own intake.
