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
  // Quoting, Delivery, Projects, Configuration decks added in subsequent tasks
]
