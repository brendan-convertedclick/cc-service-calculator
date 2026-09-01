# Conductor — Agent Handbook

Internal service calculator for Converted Click. React SPA + Supabase. See the plan at `~/.claude/plans/https-lpgwxacoqiqpcfpkklib-supabase-co-i-cuddly-puffin.md` for the full V1 spec.

## Hosting — prod is Cloudflare Pages, the tunnel is dev

Two hostnames, and they are not the same thing:

| URL | What it is | How code gets there |
| --- | --- | --- |
| `https://conductor.convertedclick.co.za` | **Production.** Cloudflare Pages project `conductor` (direct upload, no Git integration), account "Converted Clicks Account". Also reachable at `conductor-ehv.pages.dev`. | `npm run deploy` — builds and uploads `dist/`. Nothing deploys on push; a commit that is not deployed is not live. |
| `https://conductor-dev.convertedclick.co.za` | **Dev preview.** The cloudflared tunnel `conductor` → this machine's Vite dev server on `localhost:5391`. | HMR from the working tree. Uncommitted work shows here and only here. |

- The build is a static SPA. `public/_redirects` (`/* /index.html 200`) is what makes deep links work — without it Pages 404s on every route but `/`.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked into the bundle at build time from `.env.local`, so `npm run deploy` must run on a machine that has it.
- The tunnel is a **public URL**, so `isLocalDev()` (`src/lib/env.ts`) tests for localhost positively. It used to test "not the prod hostname" — on a `-dev` host that would auto-sign the internet in as the shared `team@` owner. Do not loosen it back.
- The tunnel serves `/mcp` (Vite proxies it to `mcp-server` on 8787), so the HTTP MCP URL is on `conductor-dev`, not prod. Prod is static — it has no proxy.
- Edge functions link users to prod (`APP_URL` in `supabase/functions/*`), which is correct — those emails and ClickUp comments should not point at a laptop.
- Tunnel config is `/etc/cloudflared/config.yml` (root LaunchDaemon `com.cloudflare.cloudflared`). `DEV_ALLOWED_HOSTS` in `.env.local` must list the tunnel hostname or Vite refuses the request.

## Development workflow

Feature work defaults to **superpowers subagents with git worktrees**:

1. Use the `superpowers:using-git-worktrees` skill to create an isolated worktree before touching code.
2. Use the `superpowers:dispatching-parallel-agents` or `superpowers:subagent-driven-development` skills to execute independent tasks in parallel subagents.
3. Each subagent works in its own worktree branch; changes are reviewed and merged back to main.

## Shared dev login

- Email: `team@convertedclick.co.za`
- Password: `cc-calc-2026-temp`

Shared dev/admin login, treated as `owner` role for ergonomics (see `useCurrentRole`). There is no `team_members` row for this email, so `currentUserId` resolves to `null` when signed in as `team@…`. For attributable writes in testing, sign in as `brendan@convertedclick.co.za` instead.

Per-staff logins are real and live (not V1-out-of-scope): `team_members.role` (`staff`/`admin`/`owner`) + `team_members.auth_user_id` → Supabase Auth (migration 0052). `App.tsx`'s local `RequireAdmin` gates routes — `staff` role is bounced to `/staff`. (A shared `RequireRole` component once did this; it was deleted in the 2026-08-09 audit because `App.tsx` had reimplemented it inline and nothing imported it. Do not recreate it.) There's no invite/provisioning UI yet — a staff Supabase Auth user + matching `team_members` row currently has to be created by hand.

**Everyone gets the shell.** `AppShell` (nav rail + breadcrumbs) wraps every authenticated route, staff included, and `navEntriesFor(role)` in `components/nav/navItems.ts` filters it. Nav visibility and route gating must agree: a `NavItem` with no `roles` is admin/owner (matching `RequireAdmin`); `roles: ALL_ROLES` marks the surfaces open to everyone — `/staff` ("My work", `src/pages/StaffBriefForm.tsx`), `/systems` (the whole library, editable by everyone) and `/profile` (`src/pages/Profile.tsx`: own name/department/skills, ClickUp + Google connections, sign out). `/settings/google` is outside the admin gate too — it is per-user connection state, not an org setting. A section whose items all filter out is dropped; one that filters to a single item renders as that item.

**The systems library is everyone's to write.** `system_definitions`/`system_edges`/`process_steps`/`process_step_procedures` are read-and-write open to any `authenticated` user (0118) — procedures are documented by the people who run them, so do not re-gate these on role. The single admin/owner act is **publishing** a revision: `publish_system_revision` raises `admin or owner role required`, and the `system_revisions` policies let anyone write a `draft`/`proposed` row while restricting `published`/`superseded` to admin/owner, so a direct insert can't route around the RPC. In the UI that's the pre-existing `canApprove` in `SystemDetail.tsx` — there is no `canEdit`.

**Publishing also needs named sign-offs (0126).** `system_revision_approvals` is who agreed to a revision and when: one row per person, `required` (publish waits for them) or optional (a log entry). `publish_system_revision` raises if a revision has *no* approvers at all, or if any required one has a null `approved_at` — so a revision cannot publish until someone records who approved the procedure. A sign-off is stamped at the click, never typed: the datetime is read-only and you can only sign your own row, so it records when the approval actually happened rather than what someone entered on another person's behalf. Back-dating is therefore gone, and the shared `team@` login (null `currentUserId`) can no longer sign anything — approvals are done from personal logins. The **sign-offs** do not carry forward: a new revision is a new snapshot and needs its own agreement. The **names** do — the Send-for-review dialog pre-fills from the last revision that named anyone, walking back through the history, so the same reviewers aren't re-picked every time. Carry the people, never the `approved_at`. Anyone authenticated may write the rows; the admin/owner gate stays on the publish itself.

**Approving happens on your own line.** Each approver row in `ApprovalLine` carries its own **Sign off** / **Request changes** pair, shown only on the signed-in person's row and only while unsigned — you cannot sign for anyone else, and one control per person is what makes "who is this waiting on" legible. Signing is not an admin act, so the pair renders for any role; the label reads **Approve** instead of **Sign off** when that click is the last required one *and* you may publish, because then it really does flip the revision (the same click chains `publish_system_revision`). A staff approver who completes the set gets "an admin can now approve it" rather than a failed RPC. Request changes is a decision about the revision, not about you: one reviewer's objection sends the whole thing back.

**A revision approves itself.** The click that records the last required sign-off publishes it, so there is no separate "now approve it" step and no button sitting there while people are still outstanding. `ApproveButton` — the revision-level publish leg — renders *only* when a complete set of sign-offs somehow didn't publish, which happens when the person who completed it was staff and couldn't. It is a recovery control, not the normal path. The revision card passes `publishOnly` because its rows already offer the sign-off; the Steps-pane header has no such list, so there it keeps both legs. The card header also keeps **Request changes** only for an admin who is *not* a named approver — anyone named acts on their own line instead.

**The revision diff baselines on the previous revision, not the published one.** It answers "what changed since anyone last looked", and a revision that was declined was still read. Baselining on `state = 'published'` meant a procedure that had never published had an empty `before`, so every step in the follow-up revision reported as *added* — 34 additions for a one-link change. `diffSteps` also compares `description` and `doc_links` (by value — they are text and an array), not just title/hours/dept/owner/materialise_as: a diff blind to those said "no step changes" on a revision whose whole reason for existing was attaching a checklist link.

**Reviewers are named up front.** The Send-for-review dialog collects them and won't submit without at least one **required** — `useProposeRevision` writes the `system_revision_approvals` rows inside its `mutationFn`, right after the revision insert, so they exist before the ClickUp ping reads them. Nothing enforces this in the DB: the rows can only be inserted after the revision they hang off, and the invariant that actually matters (nothing publishes unsigned) is already `publish_system_revision`'s. The rollback when the approver insert fails is best-effort for the same reason — `system_revisions_delete` is admin/owner-only, so for a staff proposer it no-ops and the revision is repaired from the panel instead. Revisions proposed before this gate have no rows at all, which is why the review ping still falls back to blanket admin+owner.

**Four states, two vocabularies.** The team's states are **Draft → In review → Approved / Requested changes**; `system_revisions.state` spells them `draft` → `proposed` → `published` / `changes_requested` (plus `superseded`, shown as "Replaced", for a revision that has been approved and then replaced). `REVISION_STATE_BADGE` in `SystemDetail.tsx` is the only place that mapping lives — the DB values, the RLS policies (0118/0137), the `publish_system_revision` guard and the e2e fixtures all still say draft/proposed/published, so do not rename the column values to match the labels. `SystemsList.tsx` mirrors the same four as the row pill, with one difference: **Approved beats Requested changes**, because a system with a live published revision is approved and the decline only closed a later proposal.

A procedure with no revision row at all reads as Draft: nothing has been sent to anyone yet. There is no draft → in-review transition on an existing row — "Request changes" moves a revision to `changes_requested` for good and the fix goes out as the next revision, which is deliberate: `system_revision_approvals` hang off a revision id, so re-opening a signed-off row would let changed content ride on sign-offs recorded against a different snapshot. `changes_requested` (0137) is that same terminal stop under its own name; it used to be plain `draft`, which made a revision someone had reviewed and left notes on indistinguishable from one nobody had opened. It carries no decliner/date of its own — the notes in `StepNotesPanel` are the substance, and the row still shows who sent it for review. On the RLS side it sits with draft/proposed: anyone authenticated may write it, only `published`/`superseded` are admin/owner.

**Systems approvals post to ClickUp.** `notify-system-revision` puts all three transitions — sent for review, approved, changes requested — into the **⚙️ Systems** ops channel (`SYSTEMS_CHANNEL_ID` in `_shared/clickup-chat.ts`), the fourth of the workspace-wide ops channels alongside 🆕 New Tasks / 📅 Meetings / ✅ Approval Requests. "Sent for review" pings the revision's **required** approvers by name (falling back to every admin and owner for revisions proposed before the dialog collected them); approved and changes-requested ping the proposer and the system's owner, deduped. It is fired from `onSuccess` in `useSystemRevisions.ts` — never from a `mutationFn`, so a chat outage can't fail a publish — and every call is `.catch(() => {})`, which means a bad deploy is **silent**: it must be deployed `--no-verify-jwt` like every other function here, and blanking the channel constant makes it no-op rather than error.

**Status changes are events, not just a column (0146).** `client_activity.kind = 'status'` carries `from_state`/`to_state` instead of text, with `body` as an optional reason — which is why `body` stopped being NOT NULL and the length check now applies only to the kinds whose whole content *is* the text. Inferring history from `client_approvals.state` gives you the latest value and nothing about the journey: who reopened it, when, and whether anyone said why.

`useSetItemState` is the manual override in `ActivityPanel` — for when a client confirmed on the phone, or something was closed by mistake. Two DB rules shape it: `client_approvals_decided_chk` requires state and `decided_at` to move together, so **reopening clears the whole decision** (name, email, contact id, stamp) rather than just the state — leaving a decider on something nobody has decided is how a record stops being one — and settling fills the frozen `decided_title`/`decided_ask` (0142) on the way in. The status row is written **after** the update succeeds: a timeline claiming a move that did not happen is worse than a move with no timeline entry.

The timeline says "reopened this — back to waiting on the client" when it comes back from a settled state, rather than the bare destination, because "moved this to waiting on the client" reads like the first time it was ever sent.

**An agreement has two sides (0145).** `owed_by` is `client` (they committed) or `us` (we did) — `client_approvals_owed_by_type_chk` restricts `us` to `item_type = 'agreement'`, because a sign-off we owe ourselves is nonsense and a question we ask ourselves is a note. It changes three pure derivations in `client-review.ts`: `bucketOf` puts a pending agreement of ours under **With us** rather than in their "Your move" pile, `isOverdue`/`dueStatus` return nothing for it (our late commitment is ours to fix, not a red badge on their page), and `typeLabelFor`/`agreedLine` read "We agreed" instead of "You agreed". The client sees it read-only with the thread underneath — offering them a Done button on our own promise would be absurd.

Ours are closed by staff from `ActivityPanel` (`useCloseOurAgreement`), which lands in the same `approved` state everything else settles into but stamps `decided_by_name` as the staff member "(Converted Click)" rather than putting a client contact's name against something they had no part in. It fills the frozen `decided_title`/`decided_ask` too — a commitment can be edited after the fact just like an ask can.

**"Turn into a task" creates a brief and stops there.** `useAgreementToBrief` writes the `briefs` row and hands it to the existing `QuickBriefSheet`, which already knows how to turn a brief into a ClickUp task with work stream, points, assignee, list and checklist. Rebuilding that form would be a second copy of the one screen everybody knows, and it would drift. `client_approvals.brief_id` links the two — reused rather than adding a second column, so "what did this become" has one answer — and the button reads "Open its task" once it is set, so one promise never becomes two tasks.

**Every count on `/client-signoffs` uses one definition of "waiting on this client":** an undecided ask they owe us (`state = 'pending' and owed_by = 'client'`), or a task in their court. The rail's per-client rows used to mix approvals and tasks while "All clients" counted approvals only, so the two disagreed on screen. Tab labels and the summary line are scoped to the picked client — a number that stays at the agency total while the page shows one client is a number nobody trusts.

**`ITEM_COLUMNS` in `useClientSignoffs.ts` mirrors the edge function's list and must not gain a staff-only field.** `brief_id` rides a separate `STAFF_ONLY_COLUMNS` constant on the cross-client query alone; that separation is the whole value of the mirrored constant.

**The item timeline is mostly derived, not stored (0143).** `ActivityPanel` is the right-hand **column beside the client preview** on `/client-signoffs`: clicking a task in the client's own queue fills that card with how the item has gone, plus a box to do something about it. It began as a drawer opened from the table below and nobody found it, because that table sits under a 720px preview — `ClientReview` therefore takes an optional `onSelectedItemChange` so the staff page can follow the preview's selection. That callback is preview-only and changes nothing about the rendering; the client route never passes it. It is **not** ClickUp's activity feed: every field edit logged is a feed nobody reads, so it carries only the touch points that change what you would say on a call.

`client_activity` stores exactly one thing — text somebody typed. Everything else on the timeline is derived at read time from columns that already hold the fact, because writing them as event rows too would give two sources for one truth and a guaranteed drift:

| Event | Comes from |
| --- | --- |
| asked | `client_approvals.created_at` |
| emailed / failed | `outbound_emails` via `client_approvals.outbound_email_id` |
| opened | `client_review_tokens.last_used_at` — since 0142 a token belongs to one person, so this already says **who** opened and when, deduped to the newest open per contact |
| decided | `decided_at` / `decided_by_name` / `client_note` / `state` |
| message, note | `client_activity` |

`src/lib/client-timeline.ts` is the pure merge, oldest-first (it reads as a story, not a feed) with a stable sort so equal timestamps keep their logical order. **`kind` is the load-bearing distinction:** `message` is emailed to the client and they can see it; `note` never leaves the database. The composer is one send button whose label, colour and helper text all change with the mode, rather than two adjacent buttons a tired person picks the wrong one of. Like questions, a message mints **one personal link and one email per recipient**, and the activity row is written **first and always** — a chase we sent is history whether or not the mail server cooperated, and a chase that vanishes on a bounce is how the same client gets chased twice.

**The thread runs both ways (0144).** `client_activity.kind` has three values and they must never be confusable in any UI: `message` (we sent it, emailed, and they see it), `client_message` (they wrote it back on their page) and `note` (ours only, never leaves the database). The client-facing list query filters to `('message','client_message')` **in the query, not in JS**, in both the edge function and the staff preview mirror — an internal note reaching a client is the one unrecoverable failure on that page, so a later refactor of the mapping must not be able to leak one.

`action: "reply"` on `client-review` is deliberately **not** a decision: it leaves the item `pending`, because "the logos are with marketing, give me till Friday" and "I approve this" are different acts and conflating them would sign off things nobody signed off. The reply's author comes from the token contact (0142) and is snapshotted into `author_name` so it survives the contact row being deleted; on a legacy shared link there is nobody to name and the message is recorded anonymously rather than refused — a client with an old link must still be able to answer us. Staff are pinged in the Approvals ClickUp channel, fire-and-forget, because a reply nobody sees is worse than no reply box at all.

The client's detail column is capped at **46rem**. It is whatever is left of a monitor after the rail and the queue, so uncapped it stretched the answer box and every message bubble across the full width of a wide screen. The column still grows; the content sits inside it.

Emails greet on **first name only** (`greeting()` takes the first whitespace-delimited token). The full name is for the record — who signed a thing off, "Signed in as …" on the portal — not for the top of a note.

On the client's side the item is **one thread and one box** (`ItemConversation`). It replaced a split that confused people: the ask had its own section with its own textarea and Send, and a second textarea and Send sat under it for "Talk to us about this" — two identical boxes that settled different things, where the wrong guess either signed something off or failed to. Now `threadOf` (pure, in `client-review.ts`) prepends the ask as the first message and everything since follows in order, so there is exactly one place to type. **What pressing send DOES is carried by the buttons**, never by which box you landed in: Approve takes no words and is its own button; Request changes and an answer need the same words a message does, so they share the one box. A **question has no separate approval** — while it is open, sending IS the answer, which is why its button reads "Send answer" and the helper line says so.

A client's decision **joins the thread as their own bubble** — `threadOf` appends `client_note` at `decided_at` and re-sorts, so a message sent after a decision still lands below it. Their answer used to be stored on `client_note` and shown only as a confirmation banner *above* the conversation, so the words they had just typed vanished from it. The outcome line now closes the thread instead of opening it: a conversation reads downward, and announcing the ending before the messages that led to it does not.

Our half of the thread renders as **"Converted Click"**, never a staff name — `ReviewMessage.author` is populated only for their own colleagues, and the server does not send ours. `ReviewItem.created_at` exists purely to date that opening bubble.

**Client emails carry a stage-count reminder.** Every question and message renders the three buckets the client already sees — Waiting on you / With us / Signed off — as a three-cell table above the button, with the oldest-waiting line under it. Three rules make it work:

  * **It renders whenever the client has anything on their page at all** — waiting, with us, or already settled. It used to require `waitingOnYou > 0`, on the argument that "0 waiting on you" undoes a chase; that was right about a chase and wrong about everything else, because the moment a client answered their last open item the block vanished from every subsequent email and read as breakage. "0 · 0 · 1 signed off" is a true and useful sentence. Only a genuinely empty page shows nothing (`shouldShowCounts` in `client-email.ts`).
  * **The buckets and the age are not redefined.** `countStages` in `client-stage-counts.ts` uses `pressureDays` from `client-review.ts` — the same function the client's queue sorts by — so the email and the page cannot disagree about the same client in the same minute.
  * **`fetchStageCounts` never throws.** A counting failure must not stop a chase going out; null means no block, which the template already treats as silence.

It is counted **after** the question row is inserted, so the question being read is included in its own count. Tables only — no flexbox or grid reaches an inbox, and a test asserts that. Rounded corners go square in Outlook's Word engine, which is why the emphasis is weight and colour rather than shape.

**Width is a wrapper, not a CSS property.** The body had no container at all, so it filled whatever reading pane it landed in — on a wide monitor that put the three count cells almost a screen apart. It is now a nested table: the outer one spans, the inner is pinned with `width="600"` **as an attribute** for Outlook's Word engine (which ignores `max-width`) plus `max-width:600px;width:100%` for everything else so it still collapses on a phone. Left-aligned, not centred — a centred column reads as a marketing template. Each `<p>` repeats its own font style because Outlook does not inherit it from the container. **No negative margins anywhere**: mail clients handle them unreliably, so the gap under the counts strip is handed to whichever element ends the block.

**The pasteable URL under the button is gone** — it printed a 60-character token twice on screen and was the single most cluttered thing in the email. The plain-text part still carries the address, so a text-only reader loses nothing, and a test pins the URL to appearing exactly once in the HTML.

`src/lib/client-email.ts` is the single template shell for both the question and message emails (they are the same letter with a different middle); it replaced `client-question-email.ts`. Its inline `font-size` is deliberate and the design hook's finding there is a false positive — mail clients strip `<style>` blocks and CSS custom properties, so the token system cannot reach an email body.

**A client approval is evidence, not an assertion (0142).** Two separate gaps, and only the second was about identity:

  * **The log used to point at a live row.** `client_title` and `ask` stay editable after someone signs, so re-wording an item silently rewrote what they had agreed to. `decided_title` / `decided_ask` freeze the exact text at the click and are **never updated again**; `EvidenceDialog` reads the frozen copy and warns when the live wording has drifted from it. Rows decided before 0142 have no frozen copy and fall back to the live text, labelled as such.
  * **Attribution used to be self-declared.** `client_review_tokens.contact_id` scopes a link to one person, and when it is set the review function resolves the signer from the token and **ignores `identity` in the request body entirely** — otherwise the personal link buys nothing, since the body is written by whoever holds it. `signed_in_as` on the list response is what makes the page greet them by name and skip "And you are?". A null `contact_id` is a legacy company-wide link and still gets the picker, so nothing minted before this migration broke.

The FK is composite — `(contact_id, client_id) → contacts (id, client_id)`, which needed a unique index on that pair — so "this person belongs to this client" is a database guarantee rather than something each caller must remember. Handing someone a link that signs as a person from another company is exactly the failure `weighty` was invented to prevent.

`decided_ip` and `decided_user_agent` are evidence only: an IP is trivially shared and must never be used to recognise anyone. **Deliberately not client accounts** — a login wall is the single biggest reason a client never arrives, which is why 0139 captured identity at the decision rather than at the door; per-person links keep that property and remove the guesswork. Note `weighty` is still read in four places and written by nothing: it is the natural switch if an emailed one-time code is ever added for items that carry liability.

Asking a question mints **one token and sends one email per recipient**, because two people on one shared link produce an answer nobody can be held to. A failed send is collected rather than thrown, so one bad address does not strand the recipients queued behind it.

**Contacts are edited on the client page (`ContactsPanel`), above the sign-off link panel.** Until 2026-08-31 `contacts` was **read-only in this app** — five places queried it and nothing wrote it, so the only rows that existed were the conservative handful the 0139 backfill could vouch for. Every feature that needs a named human was therefore dead for almost every client with no way in the UI to fix it. `useContacts.ts` is now the single hook for reading and writing them; do not add a second one (`useClientAsks` briefly had its own and it was folded in).

Email is **immutable after creation**: it is half the unique key and personal review tokens hang off the contact id, so silently editing an address would re-point a live link at a different person. Wrong address = delete and re-add. Deleting a contact **cascades to their personal tokens**, which is the point when someone leaves — and their name survives on anything they already decided, because `decided_by_name` is a snapshot (0142), not a join. Exactly one contact is primary per client, enforced as clear-then-set rather than a partial unique index: the index would reject the intermediate state of a two-statement swap and there is no transaction from the browser.

**Personal links need contacts, and most clients have none.** The 0139 backfill deliberately seeded only what it could vouch for — as at 2026-08-31 that is Pimms (4), Trellidor (3) and Trellidor UK (2), and every other client has zero. A client with no contacts can only be given a shared link, so adding the people who sign things off is the prerequisite for attributable approvals, not an optional tidy-up.

**The sign-off page answers three different asks (0141).** `client_approvals.item_type` is the discriminator: `brief` (a deliverable awaiting **approval**), `question` (something we asked, awaiting an **answer**) and `agreement` (something the client committed to, awaiting **doing**). One table, because the client portal reads exactly one table — a question stored anywhere else is a question the client never sees. `brief` is deliberately not renamed to `task`: the ClickUp candidates flow and `client_approvals_brief_ref_chk` key off that value, and "Task" is only a UI label. The three render different controls in `DecisionControls` (Approve/Request changes · one answer box · Done/Not yet) and different settled copy, but share one state machine — `approved` means settled, `changes_requested` means it comes back to us. `client_note` is now written on **every** decision, not just changes_requested: for a question that column *is* the answer. The server requires a non-empty comment when the decision is `changes_requested` **or** the stored `item_type` is `question`, read from the row rather than the request.

A **question** sends an email the moment it is written (`useAskClientQuestion` → `buildQuestionEmail` → the existing `send-outbound-email`, so it goes as the signed-in person with an `outbound_emails` audit row). There is no new edge function and no compose screen — the body is a fixed template, because a question that takes two minutes to send is a question that gets asked tomorrow. Every question **mints its own token**: `client_review_tokens` stores hashes only, so an existing link cannot be recovered to reuse. Those tokens therefore carry a 60-day `expires_at`, or a client accumulates one permanently live link per question ever asked. The shared `team@` login cannot send at all (`outbound_emails.composed_by` is NOT NULL and `currentUserId` is null) and is told so up front. An **agreement** sends nothing — `agreed_at` and `agreed_via` are mandatory in the DB because "you said in the meeting on the 4th" is the whole feature and a commitment with no date is a grievance, not a record.

**Who the delay belongs to (0141).** `briefs.client_wait_ms` / `internal_wait_ms` are cumulative ms from ClickUp's own `bulk_time_in_status`: time in a client-waiting status (`waiting on client`, `send to client`) versus time in one of ours. Both are written by `sync-clickup-actuals`, and three things about that were wrong and are now load-bearing:
  * **The bulk call runs at the very top of the function.** It used to sit after the projects and ongoing-task loops, by which point their few hundred sequential per-task fetches had put the PAT over ClickUp's rate limit — it returned 429 on every tick for weeks, which is why every `client_wait_ms` in the table was 0 or null. Do not move it back down.
  * **Minutes live in two places.** The raw v2 REST response nests them as `total_time.by_minute`; wrappers flatten them to `total_time_minutes`. Reading only the flat one made every resolved task report zero even after the 429 was fixed. Read both.
  * **A failed per-task fetch no longer discards a good wait figure.** The bulk response carries `current_status`, so it is the fallback when the one-call-per-task `fetchTask` is the thing being rate-limited. `actual_hours`/`actual_points` are still only written when that fetch succeeds — a failed fetch reports 0 time spent and writing it would wipe real actuals.

The figures are stale by up to half an hour (the cron), so `src/lib/client-waiting.ts` extrapolates the *running* clock client-side: whichever side currently holds the task gets `now − clickup_status_synced_at` added on top of its banked total, and a closed task's two numbers are frozen. That is the "Who's holding it up" tab on `/client-signoffs`, with an Open/Closed/Everything filter — the open rows are today's chasing, the closed ones are the pattern, and the pattern is the argument.

**The clock stops while the work is with the client (`src/lib/stop-clock.ts`).** A thirty-day due date is not thirty days of working time if twenty of them were spent waiting for assets, and the tab used to show the wait and the due date as two unrelated facts — so the only thing on screen was "32 days past its date", which reads as us being late even when every one of those days was theirs. `impliedDueMs = original_due_date + client_wait_ms` is the whole derivation. Three rules keep it defensible rather than self-serving:

  * **Only client-held time moves a date. Queued time never does.** A deadline that slips because *we* had not started is one nobody believes twice, and a single row like that discredits every other row on the page. The Kings College boosted-posts task (25 days in `planned`, no client wait) is the live example: its verdict is `ours` and its date does not move.
  * **Both counts survive.** `pastDueDays` (how far past its own date it has run — the number the tab has always shown) and `lateDays` (what is left of that once their days come off) are rendered side by side. Showing only the second is an excuse; showing only the first was the bug.
  * **`bornLate` rows never lead.** A sign-off drafted from an existing ClickUp task inherits that task's due date, so `created_at` is when Conductor found out, not when the clock started — four of Kings College's six waiting items have a due date earlier than their own creation. There is no runway to measure on those, so `runwayDays` is null rather than negative, and `summariseStopClocks` excludes them from `leadIndex` (their days still count toward the total). Leading on the *soonest* adjusted date instead of the *largest movement* hands the headline permanently to a date nobody set.

`RunwayChart` draws it: every row pinned to a shared DUE line, the runway left of it as a trough that **fills** as it is consumed, the overrun right of it coloured by cause, a dashed stop-clock tick and a LATE BY column. An earlier version drew all the client's time to the right of the due line, which made a client eating twenty days of a thirty-day window look like a task that ran over. **The order of the bands inside a bar is a convention, not a chronology** — `client_wait_ms` is a running total with no dates on it, so we know they held something 38 days but not which 38. Keeping ClickUp's `status_history` in `sync-clickup-actuals` instead of only its sums is what would make the positions real.

**The mechanism to act on it already exists and is not yet wired.** `extension_requests` is a complete flow (tiered auto/admin/owner, approved in `Approvals`, written back to ClickUp by `approve-extension-request`), and `useDelayTrend.ts` already computes this same attribution after the fact — it marks a late delivery client-caused when `clientWaitDays >= daysLate`. What is missing is the trigger: a "Request new date" on an `extend`/`tight` row that pre-fills `requested_due_date` with the stop-clock date and writes `due_date_reason` from the wait figures. `client_delay_manual` is the matching override for tasks where the waiting status never got set — read by the delay report, written by nothing.

**Notes are a table, not a column (0133).** `process_step_notes` is the running commentary a team leaves on a procedure: one row per note against a task or step, with `created_by`/`created_at` and a `done_at`/`done_by` tick. They are edited in the right-hand panel (`StepNotesPanel`), never inline. `process_steps.description` is a different thing and stays — it is procedure content, rendered on the canvas node and carried by the ClickUp push. Notes are deliberately outside `system_revisions.body` (that snapshot is `select('*')` on `process_steps`): they record what happened while running the procedure, not what it says. `created_by` is nullable because the shared `team@` login resolves `currentUserId` to null. The tick completes the **note**, not the step — step completion lives in ClickUp. `assigned_to` (0135) is who the note is *for*, also nullable: the panel lists every note on the procedure grouped by row, and the systems rail carries an **Assigned to me** filter that hides itself on the shared login, where nothing can be assigned to you. Each list row carries one note pill counting **every** open note on the procedure (`useOpenNoteCounts`), lit up when some of them are yours (`useMyOpenNoteCounts`) and silent at zero — one pill in two states, not two pills.

`team_members` (0115, fixed by 0117): anyone may read; only admin/owner may write anyone's row; a person may write their own, with `role`, `cost_rate_cents`, `email`, `archived_at` and `tracking_mode` held immutable by a BEFORE UPDATE trigger. That trigger fires for service-role writes too (RLS is bypassed, triggers are not), so it exempts `auth.uid() is null` — without that, `google-token`'s provisioning upsert silently fails to set `auth_user_id`. `current_team_member_role()` resolves the shared `team@` login to `owner`, so it keeps working.

## Telegram channel session guardrail

When this project is running as a Telegram channel session (the "Channels (experimental) messages from plugin:telegram" banner is shown), **never call `AskUserQuestion`**. There is no one available to click an option in a terminal UI — the tool call blocks forever, which permanently wedges that conversation's message queue (every later Telegram message enqueues but never gets a reply, and restarting `claude --channels` just resumes the same poisoned session since it re-attaches to the same conversation). If a clarifying question is genuinely needed, ask it as a normal chat reply and wait for the next inbound message instead.

If a channel session ever does get stuck this way, don't just restart the launcher — check for orphaned `claude --channels` processes first (`ps -ef | grep -- "--channels"`; `screen -X quit` can silently fail to kill grandchildren, leaving a duplicate poller on the same bot token), then relaunch with an explicit fresh `--session-id <uuid>` so it doesn't resume the poisoned transcript.

## conductor MCP server setup

The repo ships an MCP server at `mcp-server/` exposing 24 tools: 20 for intake (clients, briefs, sender rules) and 4 for the systems library (`list-procedures`, `get-procedure`, `create-procedure`, `add-procedure-task`). `mcp-server/README.md` is the full account — setup, the procedure-writing shape, and the security position.

**First-time setup (once per machine):**

```sh
cd mcp-server
npm install
cp .env.example .env
# Edit .env — fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

The server runs via `npm run dev` (tsx, no build step needed). It is registered in `.mcp.json` as `conductor` and starts automatically when Claude Code opens this repo.

To call tools in agent sessions: use `mcp__conductor__<tool-name>`.

**Two transports, one tool registry.** `src/server.ts` builds the server; `src/index.ts` serves it over stdio (what `.mcp.json` launches) and `src/http.ts` serves it over **stateless** Streamable HTTP for clients on other people's machines — a server and transport per request, nothing held between calls. `npm run http` listens on 8787, `vite.config.ts` proxies `/mcp` to it, and the existing tunnel makes that `https://conductor-dev.convertedclick.co.za/mcp`.

Adding a tool means one entry in the `tools` table in `src/server.ts` — do not register it in an entry point, or it will exist on one transport and not the other. Mark it `true` in the fourth slot if it only reads; clients use `readOnlyHint` to decide what may run without asking.

**The HTTP transport is live** — `pm2` runs it as `conductor-mcp` (root `ecosystem.config.cjs`), a launchd agent resurrects pm2 at login, and it binds 127.0.0.1 only, so the Vite proxy is the one thing that can reach it. It is therefore up only while the dev server on :5391 is: the tunnel publishes `/mcp` *through* Vite, not around it. `pm2 logs conductor-mcp` when a client says the URL is dead.

**It runs on the service role key and is gated by one shared bearer token (`MCP_AUTH_TOKEN` in `mcp-server/.env`, generated 2026-08-19).** That token is the only thing between the internet and every client, brief and rate in the agency. Per-user auth is the real fix and has not been done — don't hand the URL outside the team until it is, and rotate the token when someone leaves.

**Writing procedures through the MCP.** `create-procedure` takes departments, owners and services **by name**, not uuid, and resolves every name before writing anything so a typo fails with nothing created. It writes the same rows the editor writes: top-level `process_steps` = task (`materialise_as: 'task'`), children = steps (`'checklist_item'`), consecutive tasks chained by a `system_edges` row and laid out left-to-right. Hours go on the steps — the rollup trigger owns the task's total. The result is a draft; publishing stays an admin act behind `publish_system_revision`.

### Sender rule enforcement in intake

The intake flow must call `mcp__conductor__evaluate-sender` before
`create-brief` for every inbound thread on a known client domain. Decision values:

- `allow` — proceed and create the brief normally.
- `block` — skip the thread; tag it `CC/Intake/Blocked` so it isn't reconsidered.
- `pending` — sender is on a known client domain but has no rule. Proceed,
  but a `pending_senders` row is queued automatically by `create-brief` and
  must be resolved by the operator in **Clients → [client] → Senders**.
- `unknown` — sender's domain is not a client domain (current ignore behavior).

`create-brief` also performs a defensive block check, so an outdated intake
flow can never insert a blocked sender. `sync-messages` drops inbound messages
from blocked senders before upserting.

## Supabase — use the project-scoped MCP server ONLY

This repo ships a dedicated MCP server in `.mcp.json` named **`cc-supabase`**, pinned with `--project-ref=lpgwxacoqiqpcfpkklib`.

- When working in this repo, use **`mcp__cc-supabase__*`** tools exclusively for any database, migration, edge function, or schema operation.
- **Do not use the default `mcp__supabase__*` tools here.** The default server is pointed at a different project (`hmosfbevnlzmduqnvdxz`) and will corrupt unrelated data.
- The access token is read from the environment variable `SUPABASE_ACCESS_TOKEN_CC_CALCULATOR`. Set it in your shell before starting Claude Code:

  ```sh
  export SUPABASE_ACCESS_TOKEN_CC_CALCULATOR="sbp_..."
  ```

  Never commit the token.

## Project conventions

- **Stack:** Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Supabase JS + React Router + TanStack Query + react-hook-form + zod.
- **Money:** stored as `int` cents in Postgres. Format on the edge with `Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })`.
- **Hours:** numeric(6,2) in the DB.
- **Allocation sum tolerance:** 99.5–100.5. Triggers enforce this.
- **Environment:** `.env.local` is gitignored; `.env.example` shows the shape. Vite prefixes with `VITE_`.
- **Dev server port:** pinned to `5174` with `strictPort: true` in `vite.config.ts`. Other devs on the team use 5173 — do not change this port.
- **AI:** Anthropic Claude Sonnet 4.6 via a single Supabase Edge Function `generate-process-steps`. Key stored as Supabase secret, never shipped to the browser.
- **Ongoing tasks (overhead):** Time spent on standups, internal meetings, admin/comms, learning, and sales/BD is tracked via *perpetual* per-person ClickUp tasks living in `settings.clickup_internal_list_id`. Provision them from the Team page (one click per member). Task names follow `[Internal] {full_name} — {Category}` so Rize.io can auto-match. These tasks never close. Time flows in from Rize → ClickUp → `ongoing_actuals` via `sync-clickup-actuals` (existing cron). In the productivity view, ongoing-task hours are split out as Overhead — they're classified by checking each ClickUp time entry's `task.id` against the active `ongoing_tasks` set inside `get-productivity`.
- **Edge function helpers:** shared via `supabase/functions/_shared/`. Use `cors()`, `json()`, `createUserClient(req)`, `createServiceRoleClient()`, `callAnthropic({...})`, `buildBriefComment(...)`, `resolveListAlias(...)` instead of inlining.

## Design tokens — Figma is the source of truth

The app's visual language (colors, typography, radius, elevation) is driven by **Material 3 role-based tokens** defined in Figma and synced into the repo.

- **Single source of truth:** `tokens/base.json`. Hand-edits to this file are OK for prototyping but will be overwritten by the sync script.
- **Generated artefacts (committed):**
  - `src/styles/tokens.css` — CSS custom properties (`--mcolor-primary`, `--radius-lg`, `--elevation-level1`, `--font-sans`) + shadcn aliases (`--primary`, `--background`, `--border`, …) for both light and `.dark` modes.
  - `src/styles/tokens.ts` — typed exports consumed by `tailwind.config.ts`.
- **Never edit the generated files by hand** — they carry a banner. Run `npm run tokens:build`.

### Workflow

1. **Figma variables naming convention** (must match exactly for the sync script to pick them up):
   - Color variables: `color/<role-kebab-case>` — e.g. `color/primary`, `color/on-primary`, `color/primary-container`, `color/on-primary-container`, `color/surface`, `color/surface-container`, `color/surface-container-high`, `color/outline`, `color/outline-variant`, `color/error`, `color/on-error`, …
   - Each color variable must define **Light** and **Dark** modes.
   - Radius variables: `radius/xs`, `radius/sm`, `radius/md`, `radius/lg`, `radius/xl` as FLOAT variables (px).
2. Set `FIGMA_ACCESS_TOKEN` and `FIGMA_FILE_KEY` in `.env.local` (see `.env.example`). The PAT needs `file_variables:read` scope.
3. Pull + build: `npm run tokens:sync` — fetches variables from Figma, merges into `tokens/base.json`, regenerates CSS + TS. Commit the diffs.
4. Local prototyping without Figma: edit `tokens/base.json`, then `npm run tokens:build`.

### Using tokens in components

- **M3 role colors** are exposed as Tailwind classes via the `m-` prefix: `bg-m-primary-container`, `text-m-on-surface-variant`, `border-m-outline-variant`, etc.
- **Shadcn semantic aliases** still work: `bg-primary`, `text-muted-foreground`, `border-input` — they route to the same CSS vars.
- **Type scale:** `text-display-large`, `text-headline-medium`, `text-title-small`, `text-body-medium`, `text-label-large`, etc. These set size + line-height + weight + letter-spacing in one class.
- **Elevation:** `shadow-elev-1` through `shadow-elev-5`. Prefer elevation over heavy borders.
- **Radius:** `rounded-sm/md/lg/xl` map to M3 shape tokens. Full-round buttons use `rounded-full` (the Button component handles this).

### When to add a new token

- New color role needed → add to `tokens/base.json` (and define it in Figma), then `npm run tokens:build`.
- Per-component magic values → prefer a new token over a hardcoded hex.

## Reuse before you write — the shared helpers

A 2026-08-09 audit found the dominant defect in this codebase was not bad logic,
it was **the same logic re-implemented instead of reused**: 105 inline error
extractions, 28 hand-rolled edge-function fetches across 18 private
`FUNCTIONS_BASE` consts, 23 copies of one Set-toggle block, 16 ZAR formatters,
4 pages inlining the same filter rail. Before writing any of the following,
import the existing helper.

| Need | Use | Never |
| --- | --- | --- |
| Read a message off a thrown value | `errorMessage(e)` — `@/lib/supabase`'s `PostgrestError` is a plain object, so `e instanceof Error` is **false** and the real DB message is lost | `e instanceof Error ? e.message : "..."` |
| Call an edge function | `callEdgeFn(name, body?)` from `@/lib/edge` | a private `FUNCTIONS_BASE` + `getSession` + `fetch` |
| Format money | `formatZar(cents)` from `@/lib/utils` — money is **int cents**. `formatCurrency(zar)` in `@/lib/format` takes **rands**; check the unit | inline `new Intl.NumberFormat("en-ZA", …)` |
| Today's date | `todayISO()` from `@/lib/dates` | `new Date().toISOString().slice(0,10)` — that is **UTC**, and returns yesterday between 00:00 and 02:00 SAST |
| Toggle a value in a Set | `toggleInSet(prev, id)` from `@/lib/utils` | a 5-line `new Set(prev)` block |
| A filter rail | `FilterGroup` / `FilterOption` from `@/components/filters/FilterRail` | a fresh `<h4>` + mapped-button block |
| A Supabase client | the singleton in `@/lib/supabase` | another `createClient(...)` |
| Edge-function CORS/JSON/clients | `supabase/functions/_shared/helpers.ts` | inlining them (already 100% adopted — keep it that way) |

ESLint enforces the last two mechanically via `no-restricted-syntax`.

## Quality gates — run these, they are not decorative

**There is no CI. You are the gate.** `.github/workflows/ci.yml` was deleted on
2026-08-24: it had failed on every push to main for two weeks straight, and
because its `Dead code` step ran before `Unit tests` and `Build`, neither had
executed in all that time — a red X that verified nothing. The e2e job had also
been self-skipping since the repo secrets were never added. Nothing is checked
on push any more, so run the gates locally before you claim anything works.

`npm run verify` = typecheck + lint + unit tests. Run `npm run lint:dead` and
`npm run build` alongside it — those two were CI's job and now belong to
whoever is making the change.

- **`npm run typecheck` is `tsc -b`, not `tsc --noEmit`.** The root tsconfig is
  references-only, so `--noEmit` type-checks *nothing* and exits 0. That false
  pass is how 63 type errors and a broken `npm run build` reached main unnoticed.
- **ESLint runs on a ratchet.** Clean rules are `error`; the pre-existing backlog
  is `warn`. The cap that enforced it lived in CI and went with it — the ratchet
  is now a convention, so do not let the warning count climb.
- **`npm run lint:dead` (knip)** fails on files nothing imports. Dead files went
  11 → 0 in the audit; this keeps them there. It currently reports one false
  positive — `mcp-server/src/http.ts`, the pm2 entry point for the HTTP MCP
  transport, which is launched by `ecosystem.config.cjs` and never imported. It
  is not dead; add it to `knip.json`'s entries if you want a clean exit.
- Optional local hook: `git config core.hooksPath .githooks` lints staged files.
- Playwright specs live in `e2e/`. `systems.spec.ts` **writes to the live
  database** (prefixed rows, cleaned up in `afterAll`) — the others are
  read-only, so a routine gate should run those.

## Out of scope for V1 (do not implement)

- Xero push/pull.
- Live feedback ingestion from ClickUp or other systems.
- AI beyond process-step generation.
- Capacity/availability planning.

## Design Context

Design strategy lives in `PRODUCT.md` at the repo root — register (`product`), platform (`web`), users, positioning, brand personality, anti-references, and 5 design principles. The visual system (colors/type/components) is captured in `DESIGN.md` (generated from the Material 3 token system). Both are maintained by the **impeccable** skill (`.claude/skills/impeccable/`); run `/impeccable` for design/review/polish work — it reads these two files first. Note the token system is Figma-synced and generated (see "Design tokens" above); impeccable must use the `m-`/shadcn token classes, never hardcoded hex.

## Internal meetings — Google Calendar setup

Internal meetings reuse the existing Supabase Auth Google login (see `signInWithGoogle` in `AuthContext.tsx`) — there is no separate OAuth app.

- Set Supabase secrets `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — the same values already configured in Supabase Auth → Providers → Google.
- The Google Cloud project needs the **Calendar API** enabled and `calendar.events` added to the OAuth consent screen's scopes.
- `https://conductor.convertedclick.co.za` must be listed in Supabase Auth → URL Configuration → Redirect URLs, or the provider refresh token is never captured and every meeting reports "No Google account connected". `conductor-dev.convertedclick.co.za` and `conductor-ehv.pages.dev` are on the allow list too, so a Google sign-in works on the dev preview as well.
- Staff must sign in with Google once to grant calendar access — existing sessions (email/password or an earlier Google sign-in without the calendar scope) must **sign out and sign in with Google again**. Status/reconnect lives at Settings → Google Calendar.
- `settings.clickup_internal_list_id` must be set (Settings → ClickUp) or meetings skip the ClickUp leg entirely and their time is never tracked as overhead.
