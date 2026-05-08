// src/data/guides.ts

export type StepAction = {
  label: string
  href: string
}

export type Step = {
  key: string
  title: string
  subtitle: string
  icon: string             // lucide-react icon name
  gradient: [string, string]  // two hex colours: badge bg + callout tint
  estMinutes: number
  whyItMatters: string
  prerequisites: string[]
  playbook: string[]
  actions: StepAction[]
}

export type Deck = {
  key: string
  label: string
  icon: string             // lucide-react icon name for deck picker tab
  steps: Step[]
}

export const decks: Deck[] = [
  {
    key: 'intake',
    label: 'Intake',
    icon: 'Inbox',
    steps: [
      {
        key: 'inbox',
        title: 'Inbox',
        subtitle: 'The hub for all incoming briefs — your work queue.',
        icon: 'Inbox',
        gradient: ['#3b82f6', '#06b6d4'],
        estMinutes: 4,
        whyItMatters:
          'All client work arrives here — Gmail-relayed threads and manually created briefs live in one place. Status columns show what is waiting versus in progress at a glance, so nothing slips through without action.',
        prerequisites: [
          'Signed in to the calculator',
          'At least one brief exists (via Gmail relay or manual entry)',
        ],
        playbook: [
          'Status columns show where each brief is: New → Awaiting client → In progress → Closed.',
          'Click "Continue" on any brief to pick up where you left off — the app knows which step it is on.',
          'Use "New brief" only for briefs that did not arrive via Gmail relay.',
          'Briefs do not auto-archive — move to Closed once work is delivered or rejected.',
          'The sender email shown is the From address from the original Gmail thread.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'new-brief',
        title: 'New Brief (manual)',
        subtitle: 'Create a brief by hand when no email relay is set up.',
        icon: 'FilePlus',
        gradient: ['#6366f1', '#3b82f6'],
        estMinutes: 3,
        whyItMatters:
          'Not every brief arrives via email. Walk-in requests, phone calls, and Slack messages all need a paper trail. Manual entry ensures every piece of work is tracked from the start.',
        prerequisites: [
          'Client record exists — create one in Clients first',
          'Signed in to the calculator',
        ],
        playbook: [
          "Fill the subject line with the client's own words — it becomes the quote title.",
          'Paste the raw brief text into the body — the AI scoper reads it verbatim.',
          'Attach any supporting files before saving — attachments cannot be added after creation.',
          'Set the client correctly; changing it later requires a database edit.',
          'Leave sender email blank if the brief did not arrive via email — it is optional.',
        ],
        actions: [{ label: 'New Brief', href: '/briefs/new' }],
      },
      {
        key: 'gmail-relay',
        title: 'Gmail Relay',
        subtitle: 'Pipe labelled Gmail threads straight into the Inbox automatically.',
        icon: 'Mail',
        gradient: ['#0ea5e9', '#10b981'],
        estMinutes: 5,
        whyItMatters:
          'Eliminating the copy-paste step from Gmail to the calculator saves minutes per brief and removes human error. Label a thread and the brief is created automatically with attachments, ready to scope.',
        prerequisites: [
          'Gmail account with Google Apps Script access',
          'Relay token generated in Settings → Gmail',
        ],
        playbook: [
          'Generate a relay token in Settings → Gmail first — each user has their own token.',
          'Create a Google Apps Script in your Gmail account using the setup instructions on the Gmail settings page.',
          'Set the three script properties: RELAY_URL, USER_EMAIL, and RELAY_TOKEN.',
          'Apply the label →Inbox/Push to any Gmail thread to create a new brief.',
          'Use →Inbox/Push-Sent on sent threads to capture outbound briefs too.',
          'Attachments are automatically uploaded to Supabase Storage — no separate upload step.',
        ],
        actions: [{ label: 'Configure Gmail Relay', href: '/settings/gmail' }],
      },
      {
        key: 'brief-status',
        title: 'Brief Status Lifecycle',
        subtitle: 'How a brief moves from New → Triaged → Scoped → Quoted → Accepted.',
        icon: 'GitBranch',
        gradient: ['#3b82f6', '#8b5cf6'],
        estMinutes: 4,
        whyItMatters:
          'Status drives which action buttons appear on each brief row and determines what the team should do next. Understanding the pipeline keeps everyone aligned on what needs attention.',
        prerequisites: ['None — no setup required'],
        playbook: [
          'New — brief just arrived, no action taken yet.',
          'Triaged — someone opened it and it is being reviewed. Set automatically when you start scoping.',
          'Scoped — scope is locked, ready for the quote builder.',
          'Quoted — quote has been finalised and sent to the client.',
          'Accepted — client confirmed; ClickUp tasks have been created.',
          'Archived — work delivered or rejected; brief removed from the active view.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'file-attachments',
        title: 'File Attachments',
        subtitle: 'Attach supporting files to a brief for the scoper to reference.',
        icon: 'Paperclip',
        gradient: ['#06b6d4', '#0284c7'],
        estMinutes: 3,
        whyItMatters:
          'Briefs often come with designs, spreadsheets, or reference documents. Attaching them at intake means the scoper has everything needed without hunting through email threads.',
        prerequisites: [
          'Brief not yet saved — attachments are set at creation time only',
        ],
        playbook: [
          'Upload files using the attachment panel on the New Brief form before clicking Save.',
          'Files are stored in Supabase Storage — download links appear on the brief detail.',
          'Gmail relay automatically attaches any inline or attached files from the original thread.',
          'Supabase Storage has a 50 MB per-file limit — split large files if needed.',
          'Attachments cannot be added to an existing brief — if needed, create a new brief or note the file URL in the scope body.',
        ],
        actions: [{ label: 'New Brief', href: '/briefs/new' }],
      },
    ],
  },
  {
    key: 'scoping',
    label: 'Scoping',
    icon: 'ScanSearch',
    steps: [
      {
        key: 'scope-editor',
        title: 'Scope Editor',
        subtitle: 'The four-panel markdown editor: enhanced prose, in-scope, out-of-scope, open questions.',
        icon: 'FileEdit',
        gradient: ['#8b5cf6', '#6366f1'],
        estMinutes: 5,
        whyItMatters:
          'The scope is the contract between you and the client. Getting it right before quoting prevents scope creep, budget blowouts, and revision requests after delivery.',
        prerequisites: [
          'Brief exists in Inbox',
          'Scope page opened via "Start scope" or "Continue" on the brief row',
        ],
        playbook: [
          'The editor has four panels: Enhanced Prose, In-Scope, Out-of-Scope, and Open Questions.',
          'Enhanced Prose is a narrative summary — use client-facing language, not internal bullet points.',
          'In-Scope and Out-of-Scope use markdown — bullet lists work best for these.',
          'Open Questions is a living list of items needing client clarification before you can quote.',
          'All four panels save on blur — no explicit save button needed.',
          'Only lock scope once Open Questions is empty and the client has confirmed the scope.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'ai-scope-drafting',
        title: 'AI Scope Drafting',
        subtitle: 'How the AI auto-drafts your scope from raw brief text — and how to re-draft with nudges.',
        icon: 'Sparkles',
        gradient: ['#7c3aed', '#a21caf'],
        estMinutes: 5,
        whyItMatters:
          'Staring at a blank scope editor for a three-line brief is painful. The AI reads the raw brief and produces a first-draft scope in seconds — you edit instead of writing from scratch.',
        prerequisites: [
          'Brief has body text',
          'Anthropic integration enabled in Settings',
        ],
        playbook: [
          'The scope is auto-drafted the first time you open the scope page for a brief.',
          'The ai_drafted flag is set so the team knows the content has not been human-verified yet.',
          'Always read the AI draft before locking — it can propose scope items that are irrelevant.',
          'To re-draft, click "Re-draft" and optionally add a nudge (e.g. "focus on the SEO work only").',
          'The AI uses the Anthropic model configured in Settings — switch to Opus 4.7 for complex briefs.',
          'AI drafts consume API credits — avoid re-drafting repeatedly for minor tweaks.',
        ],
        actions: [{ label: 'Settings', href: '/settings' }],
      },
      {
        key: 'open-questions',
        title: 'Open Questions',
        subtitle: 'Track clarification items that need client answers before quoting.',
        icon: 'HelpCircle',
        gradient: ['#6366f1', '#4f46e5'],
        estMinutes: 3,
        whyItMatters:
          'Unanswered questions at quote time become change requests after the client signs. Capturing them in the scope editor ensures nothing slips through and the client has formally agreed to scope boundaries.',
        prerequisites: ['Scope page open for the brief'],
        playbook: [
          'Write each open question as a single bullet in the Open Questions panel.',
          "Send the questions to the client before locking scope — don't lock with unresolved items.",
          'Once each question is answered, delete it from the list and update the relevant scope section.',
          'An empty Open Questions panel is the signal that scope is ready to lock.',
          "If the client answers via email, paste the answer into the enhanced prose — don't just delete the question.",
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'locking-scope',
        title: 'Locking Scope',
        subtitle: 'When to lock, what it prevents, and how it advances to the quote builder.',
        icon: 'Lock',
        gradient: ['#a855f7', '#7c3aed'],
        estMinutes: 3,
        whyItMatters:
          "Locking prevents accidental changes to scope the client has already reviewed. It is the formal handoff from discovery to quoting, and records who locked it and when for the audit trail.",
        prerequisites: [
          'All four scope panels completed',
          'Open Questions panel is empty',
          'Client has verbally or in writing confirmed the scope',
        ],
        playbook: [
          'Click "Lock scope" at the bottom of the scope page.',
          'The lock records who locked it and when — visible in the brief audit trail.',
          'Locking advances the brief status to "Scoped" and enables the "Build quote" button.',
          'You can unlock scope if the client requests changes — this resets status back to Triaged.',
          'Avoid locking just to advance the workflow — locking should mean the client has signed off.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  {
    key: 'quoting',
    label: 'Quoting',
    icon: 'DollarSign',
    steps: [
      {
        key: 'project-builder',
        title: 'Project Builder',
        subtitle: 'The main quoting interface — services, totals, margin, and the SOW.',
        icon: 'Hammer',
        gradient: ['#f59e0b', '#f97316'],
        estMinutes: 6,
        whyItMatters:
          'The builder is where scope turns into money. It assembles service line items, calculates department hours, applies margin, and generates the statement of work — all in one place before anything goes to the client.',
        prerequisites: [
          'Scope is locked',
          'At least one active service exists in the catalogue',
        ],
        playbook: [
          'Open the builder via "Build quote" on the scoped brief row.',
          'The left sidebar shows the locked scope — use it as a reference while picking services.',
          'The centre pane is where you add and configure service line items.',
          'The footer shows running totals, margin slider, and discount controls.',
          'Click "Finalise quote" when all lines are confirmed — this locks the quote.',
          'You can create multiple quote versions per brief — use "Revise" on an existing quote.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'service-picker',
        title: 'Service Picker',
        subtitle: 'Adding services to a quote and understanding bundle vs checklist behaviour.',
        icon: 'Search',
        gradient: ['#f97316', '#ef4444'],
        estMinutes: 4,
        whyItMatters:
          'The picker is the only way to add services to a quote. It filters out already-added services and exposes bundle contents upfront so you do not accidentally double-count child services.',
        prerequisites: ['At least one active service exists in the catalogue'],
        playbook: [
          'Click "Add service" in the builder to open the picker combobox.',
          'Type to filter by service name or code — partial matches work.',
          'Bundle services show a "bundle" badge — adding them automatically adds all child services.',
          'Checklist services show a "checklist" badge — they use a saved or default department allocation.',
          'Already-added services are excluded from the picker automatically.',
          'Add services one at a time — bulk add is not supported.',
        ],
        actions: [{ label: 'Services', href: '/services' }],
      },
      {
        key: 'line-item-editing',
        title: 'Line-Item Editing',
        subtitle: 'Overriding qty, allocation %, and hours per line; adding notes.',
        icon: 'SlidersHorizontal',
        gradient: ['#eab308', '#f59e0b'],
        estMinutes: 4,
        whyItMatters:
          'Every project is different. Line-item overrides let you adjust hours, allocation, and quantity per brief without touching the master service definition — keeping the catalogue clean while quoting flexibly.',
        prerequisites: ['Service added to the quote'],
        playbook: [
          'Click the edit icon on a line item to open the inline editor.',
          'Qty multiplies the base price and hours — use it for "3× landing pages".',
          'Allocation override replaces the service rule for this quote only.',
          'Hours override sets a fixed hours figure, ignoring the allocation-derived amount.',
          'Notes field is internal only — use it for brief-specific context for the team.',
          'Changes save inline — no separate save button.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'ai-suggestions',
        title: 'AI Service Suggestions',
        subtitle: 'Let Claude propose which services to include based on the locked scope.',
        icon: 'Wand2',
        gradient: ['#f97316', '#ec4899'],
        estMinutes: 4,
        whyItMatters:
          'Missed services mean missed revenue. Claude reads the locked scope and your current line items, then proposes additions you have not added yet based on what the brief is actually asking for.',
        prerequisites: [
          'Scope is locked',
          'At least one service exists in the catalogue',
          'Anthropic integration enabled in Settings',
        ],
        playbook: [
          'Click "AI suggest" in the builder toolbar to open the suggestion modal.',
          'The AI reads the locked scope and current line items, then proposes new additions.',
          'Toggle each suggestion on or off — only toggled-on items are added when you confirm.',
          'Review suggestions critically — the AI sometimes proposes services that are out of scope.',
          'Run AI suggestions once per quote — repeated runs cost credits without adding new insight.',
          'After accepting, review and adjust each new line item qty and notes.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'sow-editor',
        title: 'SOW Editor',
        subtitle: 'Draft and edit the HTML statement of work; use AI to generate a first draft.',
        icon: 'FileText',
        gradient: ['#d97706', '#b45309'],
        estMinutes: 5,
        whyItMatters:
          'The statement of work is the document the client receives alongside the quote. Vague SOWs lead to disputes about what was agreed — a clear SOW is your best protection.',
        prerequisites: ['Quote has at least one service line item'],
        playbook: [
          'Open the SOW panel in the builder right sidebar.',
          'Click "Draft SOW" to let Claude generate an HTML statement of work from your line items.',
          'The draft uses service scope definitions and quote metadata — review it carefully.',
          'Edit the HTML directly in the editor if the draft needs refinement.',
          'The SOW is included in the PDF when the quote is finalised.',
          'Remove any internal notes from the SOW before finalising — it is client-facing.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'recurrence',
        title: 'Recurrence',
        subtitle: 'Set per-service or project-wide recurring schedules for retainer work.',
        icon: 'RefreshCw',
        gradient: ['#f59e0b', '#84cc16'],
        estMinutes: 4,
        whyItMatters:
          'Retainer clients should not require manual re-quoting every month. Setting up recurrence at quote time automates ClickUp task creation on a schedule, so delivery stays on track without admin overhead.',
        prerequisites: [
          'Quote has line items',
          'ClickUp integration configured in Settings',
        ],
        playbook: [
          'Use the Recurrence panel in the builder to set the mode: None, Per-service, or Project-wide.',
          'Per-service lets you set a different schedule per line item (e.g. weekly SEO, monthly reporting).',
          'Project-wide applies one schedule to the whole quote — simpler for uniform retainers.',
          'Supported schedules: weekly, bi-weekly, monthly, quarterly.',
          'On acceptance the first ClickUp task set is created immediately; subsequent sets fire on schedule.',
          'Changing recurrence after acceptance requires editing the project record directly.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    icon: 'Send',
    steps: [
      {
        key: 'quote-detail',
        title: 'Quote Detail & PDF',
        subtitle: 'Review the finalised quote and download a client-ready PDF.',
        icon: 'FileCheck',
        gradient: ['#10b981', '#3b82f6'],
        estMinutes: 3,
        whyItMatters:
          'The quote detail is the final review before anything goes to the client. The PDF download is how you actually send the quote — it includes the SOW, line items, totals, and the project code.',
        prerequisites: ['Quote has been finalised in the Project Builder'],
        playbook: [
          "Navigate to a quote via the brief row's \"View quote\" button or the Inbox Quoted column.",
          'Review the version number — V1 is the first quote, V2 onwards are revisions.',
          'Click "Download PDF" to generate and download the client-ready quote document.',
          'The PDF includes the SOW, line items, totals, and project code.',
          'Click "Revise" if the quote needs changes — this creates V2 without losing V1.',
          'Mark as Accepted only once the client confirms in writing.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'sending-quote',
        title: 'Sending a Quote',
        subtitle: 'Compose the covering email and send via your default email client.',
        icon: 'SendHorizontal',
        gradient: ['#059669', '#0ea5e9'],
        estMinutes: 3,
        whyItMatters:
          'The send page pre-fills the covering email so you spend thirty seconds reviewing, not five minutes composing. It also keeps brief status in sync so the Inbox always reflects current state.',
        prerequisites: ['Quote is finalised'],
        playbook: [
          'Click "Send quote" on the quote detail page.',
          'The To, Subject, and Body fields are pre-populated from the brief and quote metadata.',
          'Download the PDF first — the email launcher asks you to attach it manually.',
          'Click "Open email + download PDF" to launch your default email client with fields pre-filled.',
          'Click "Mark as sent" after sending — this updates the brief status to Quoted.',
          'The Xero push button is a Phase 2 placeholder and is not functional in V1.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
      {
        key: 'accepting-quote',
        title: 'Accepting a Quote',
        subtitle: 'Mark a quote accepted and trigger automatic ClickUp task creation.',
        icon: 'CheckCircle2',
        gradient: ['#34d399', '#6366f1'],
        estMinutes: 4,
        whyItMatters:
          'Acceptance is the trigger for ClickUp task creation. Everything downstream — delivery, tracking, and invoicing — depends on this step being done correctly and only once.',
        prerequisites: [
          'Client has confirmed acceptance in writing',
          'ClickUp integration is configured in Settings',
          'Client has a ClickUp folder linked in Clients',
        ],
        playbook: [
          'Click "Mark accepted" on the quote detail page.',
          'This triggers push-to-clickup, which creates the full task hierarchy under the client ClickUp folder.',
          'A project record is created automatically with the project code from the quote.',
          'If the ClickUp push fails, a "Retry" button appears — fix the integration config first.',
          'The brief status moves to Accepted and the brief appears in Projects.',
          'Mark accepted only once — multiple clicks create duplicate ClickUp tasks.',
        ],
        actions: [{ label: 'Settings', href: '/settings' }],
      },
      {
        key: 'quote-lifecycle',
        title: 'Quote Lifecycle',
        subtitle: 'Draft → Sent → Accepted / Rejected / Revised — what each status means.',
        icon: 'GitMerge',
        gradient: ['#0d9488', '#0369a1'],
        estMinutes: 4,
        whyItMatters:
          'Knowing which status means what prevents duplicate sends, missed follow-ups, and overwritten work. Each status unlocks a specific set of actions and nothing else.',
        prerequisites: ['None'],
        playbook: [
          'Draft — quote built but not yet sent. PDF download and Send actions are available.',
          'Sent — email dispatched, waiting for client response. Mark Accepted or Rejected from here.',
          'Accepted — client confirmed; ClickUp tasks created; project tracking begins.',
          'Rejected — client declined. The brief can be re-scoped and a new quote built.',
          'Revised — a newer version exists. The original version is preserved for reference.',
          'Version numbers increment on each revision — V1 is never overwritten.',
        ],
        actions: [{ label: 'Open Inbox', href: '/inbox' }],
      },
    ],
  },
  // Projects, Configuration decks added in Task 4
]
