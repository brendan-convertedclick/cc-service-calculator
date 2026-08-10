# Conductor rebrand + shape convergence — implementation plan

## 1. The two decisions the user must make

### (a) The blue palette

Anchored on the logo ramp `#09C6F6 → #07A2E7 → #056DC5 → #033CA3`. M3 structure unchanged — same 28 roles, same `{light, dark}` pair shape. Only the primary family, the tertiary family, and the light-mode surface/outline tints move. **Dark surfaces stay neutral zinc** (they already are). **Secondary (slate) and error families are untouched.** **`ring` has no value of its own** — `SHADCN_ALIAS` at `scripts/build-tokens.ts:79` maps it to `primary`, so it retints for free.

Recommended `tokens/base.json` values:

| role | light | dark | anchor |
|---|---|---|---|
| `primary` | `#056DC5` | `#6EC5F7` | logo stop 3 / light tint of stop 1–2 |
| `onPrimary` | `#FFFFFF` | `#032B5E` | — / darker than stop 4 |
| `primaryContainer` | `#DCEBFA` | `#054E8E` | stop 3 at 92% L / stop 3 darkened |
| `onPrimaryContainer` | `#04305E` | `#D6EAFB` | stop 4 darkened / stop 1 lightened |
| `tertiary` | `#0F766E` | `#5EEAD4` | teal, moved off cyan |
| `onTertiary` | `#FFFFFF` | `#04302B` | — |
| `tertiaryContainer` | `#CCFBF1` | `#115E59` | — |
| `onTertiaryContainer` | `#052E2B` | `#CCFBF1` | — |
| `surfaceVariant` | `#F2F7FC` | `#18181B` (unchanged) | stop 3 at 97% L |
| `onSurfaceVariant` | `#41536B` | `#A1A1AA` (unchanged) | stop 4, desaturated |
| `surfaceContainerLow` | `#FAFAFA` (unchanged) | `#111113` (unchanged) | — |
| `surfaceContainer` | `#F2F7FC` | `#18181B` (unchanged) | — |
| `surfaceContainerHigh` | `#E5EFF9` | `#27272A` (unchanged) | — |
| `surfaceContainerHighest` | `#D2E4F4` | `#3F3F46` (unchanged) | — |
| `outline` | `#A9C7E5` | `#52525B` (unchanged) | stop 3 at 78% L |
| `outlineVariant` | `#E2EBF4` | `#27272A` (unchanged) | — |

**Contrast, computed (WCAG 2.x relative luminance), not estimated:**

| pair | new | current | verdict |
|---|---|---|---|
| light `primary`/`onPrimary` — white on `#056DC5` | **5.25** | 5.70 | AA ✓ (−0.45, still clears) |
| light `primaryContainer`/`onPrimaryContainer` | **10.89** | 12.83 | AA ✓ |
| dark `primary`/`onPrimary` — `#032B5E` on `#6EC5F7` | **7.27** | 5.60 | AA ✓ (improves) |
| dark `primaryContainer`/`onPrimaryContainer` | **6.84** | 9.23 | AA ✓ |
| light `onSurfaceVariant` on white (872 sites) | **7.85** | 7.76 | AA ✓ (improves) |
| light `onSurfaceVariant` on `surfaceContainer` | **7.29** | 7.08 | AA ✓ |
| light `onSurfaceVariant` on `surfaceContainerHighest` | **6.04** | — | AA ✓ |
| light `tertiary`/`onTertiary` — white on `#0F766E` | **5.47** | 3.68 (**fails today**) | AA ✓ (fixes a live failure) |
| dark `tertiary`/`onTertiary` | **9.70** | — | AA ✓ |
| `text-m-primary` on white | **5.25** | 5.70 | AA ✓ |
| dark `primary` on `#09090B` | **10.41** | — | AA ✓ |

Non-text (3:1 not required for decorative borders, parity with today): `outline` `#A9C7E5`/white = 1.75 vs current 1.85; `outlineVariant` `#E2EBF4`/white = 1.21 vs current 1.19.

**Gradient.** `gradient-brand` becomes `linear-gradient(135deg, #056DC5, #033CA3)` — **not** the full cyan ramp. All 9 `bg-gradient-brand` consumers pair it with `text-white`; white on `#09C6F6` is **2.02** and on `#07A2E7` is **2.86**. The bottom half of the ramp is the only white-safe sweep: 5.25 at the light end rising to 9.64. This is also an improvement on today — white on the current pink stop `#EC4899` is **3.53**, i.e. the shipping brand gradient already fails AA. Reserve the full `#09C6F6 → #033CA3` ramp for the logo mark and the non-text nav border only.

**Two consequences to accept explicitly:**
- Moving tertiary off cyan changes visible hue on `dashboardFormat`'s `on_track` pills and the ProgressRing time arc. Fine, and decided once at step 9 when the `success` role lands.
- `tokens/base.json` today is `"source": "seed"` with `"figmaFileKey": null` — **no Figma file is wired**, so the "tokens:sync overwrites base.json" risk is latent, not active. Hand-editing base.json is the sanctioned path right now. Whenever Figma is connected, seed its variables from these values first.

### (b) The button-shape rule

**Actions are pills, fields are `rounded-md`.** `rounded-full` for every action (text buttons at h-7/h-8/h-10/h-11, icon buttons square at h-6/h-8/h-10); `rounded-md` at h-10 with `px-3` for every field and field-like trigger (Input, Textarea, SelectTrigger, Combobox, MultiSelect); `rounded-lg`/`rounded-xl` for containers, with inner radius = outer − padding.

This is the smallest possible diff because it is already 96% true: **181 `<Button>` sites, zero radius overrides.** The pill held perfectly. Every violation is something that bypassed the component (114 raw `<button>`, 15 raw square icon buttons, 5 segmented controls) or two primitives inside `src/components/ui/` that never agreed with it — Combobox and MultiSelect, the only field triggers wearing the action pill, which is the mismatch the user actually saw.

Retire from the vocabulary: bare `rounded` (50 sites, untokenized 0.25rem, while the `rounded-xs` token has 0 uses), and `rounded-2xl` (4 sites, resolves to 1rem — **smaller** than `rounded-xl`'s 1.5rem).

## 2. Ordered fix plan

### Step 0 — track the brand mark (blocker, 2 lines, mechanical)
`public/conductor-mark.png` is swallowed by `.gitignore:38` `*.png`. It is referenced 3 times (`index.html:5`, `IconRail.tsx:228`, `Login.tsx:49`) and the entire repo tracks exactly **one** image (`public/favicon.svg`). Any fresh clone 404s all three.

Insert after `.gitignore:38`: `!public/*.png`. Then `git add .gitignore public/conductor-mark.png`. Do **not** narrow to `/*.png` — that un-ignores subdirectory PNGs (playwright output).

Precedes the token work because new brand assets need a tracked home before anyone produces one.

Verify: `git check-ignore -v public/conductor-mark.png` exits non-zero; `git ls-files public/` lists 2 files.

### Step 1 — the palette (blocker, 1 file + 2 regenerated, judgement already made above)
Edit **only** `tokens/base.json` (14 values across 10 roles per the table), then `npm run tokens:build`. Never hand-edit `src/styles/tokens.css` or `src/styles/tokens.ts` — both carry the AUTO-GENERATED banner.

**Commit the regenerated pair in the same commit.** CI runs typecheck/eslint/knip/test/build/Playwright and has **no** tokens-drift step; a blue base.json with stale generated files ships a silently violet app.

Blast radius: 1,621 `m-*` utility occurrences plus every shadcn alias, including `outlineVariant → --border` which `src/index.css:9` applies to `*`.

Verify: `git diff src/styles/tokens.css` shows only HSL triples changing; `npm run verify`.

### Step 2 — gradient-brand becomes a token (blocker, 4 files, mechanical + 1 judgement)
`tailwind.config.ts:104-106` is the **only** hardcoded colour in the whole token pipeline (`scripts/build-tokens.ts` contains zero hex literals — verified by re-running it and diffing byte-for-byte against the committed output). Four shadcn primitives resolve their primary state through it: `button.tsx:12`, `badge.tsx:10`, `tabs.tsx:29`, `switch.tsx:12`, plus `ClientMarginContent.tsx:37`, `NavOverlay.tsx:33`, `IconRail.tsx:46/:52/:150` — **10 class sites**.

1. `tokens/base.json` — add a new **top-level** `gradient` group holding **finished CSS strings**:
   `"gradient": { "brand": "linear-gradient(135deg, #056DC5, #033CA3)" }`.
   It must not live under `color`: `hexToHslTriple` (`build-tokens.ts:32`) throws `Invalid hex color` on anything that is not `#RRGGBB`. A new top-level group survives `tokens:sync` — `sync-figma-tokens.ts:171-181` spreads `...existing` and only overwrites `meta`/`color`/`radius`.
2. `scripts/build-tokens.ts` — add `gradient: Record<string, string>` to the `Tokens` interface (:19-27) and emit `--gradient-<name>: <value>;` in the `:root` block alongside the radius/elevation loops (~:106-118). **`:root` only** — the current gradient is mode-invariant, so single-mode emission is behaviour-preserving. Add the group to `buildTs` for parity.
3. `tailwind.config.ts:104` → `"gradient-brand": "var(--gradient-brand)"`. **Delete :105** (`gradient-brand-r`, 0 consumers repo-wide). **Leave :106** `gradient-gold` as a literal — amber by intent, not brand, 1 consumer (`Clients.tsx:287`).
4. Same commit — `IconRail.tsx:220` and `NavOverlay.tsx:135` both hold a hand-copied `linear-gradient(hsl(var(--surface)), hsl(var(--surface))), linear-gradient(135deg, #7C3AED, #EC4899)`. `--surface` **is defined nowhere**, so `background-image` is invalid and the gradient border does not render today. Replace both with `linear-gradient(hsl(var(--mcolor-surface)), hsl(var(--mcolor-surface))), var(--gradient-brand)`.

Consequence to state in the commit: **the nav gradient border starts rendering for the first time.** Intended, not a regression.

Verify: `npm run tokens:build && git diff --stat src/styles/`; Button/Badge/Switch/Tabs render blue; `grep -rn "gradient-brand-r" . --exclude-dir=node_modules` → 0.

**Do not** also change `tabs.tsx:29`'s active state to `bg-m-surface` here. It retints for free via the var. The pill/surface redesign is a step-14 decision — doing both makes the gradient work look wrong.

### Step 3 — the broken CSS vars (6 sites, 2 files, mechanical)
These look token-driven and are dead. `ProgressRing.tsx:40/:61` reference `--m-surface-container-high` (real name: `--mcolor-surface-container-high`), so the M3-baseline fallback `#e7e0ec` is what paints. `:49` and `:70` use `var(--mcolor-primary|error|tertiary)` **unwrapped** — those hold bare HSL triples, so the stroke value is invalid and the hex fallback never fires (var() fallbacks only apply to *undefined* vars).

- `ProgressRing.tsx` — replace all 4 `stroke=` attributes with classes, matching the file's own precedent at `:81` (`fill-m-on-surface`): `:40`/`:61` → `className="stroke-m-surface-container-high"`, `:49` → `stroke-m-primary`, `:70` → `className={overHours ? "stroke-m-error" : "stroke-m-tertiary"}`. Drop all four hex fallbacks.
- `ServicesList.tsx:500` → `hsl(var(--mcolor-outline))`, `:602` → `hsl(var(--mcolor-outline-variant))` (inline `style` must stay — the primary values are dynamic).

Behaviour change: two arcs that currently paint nothing become visible. Check the over-hours state.

### Step 4 — the categorical palettes (8 files, ~14 edits, mechanical after one judgement)
Three byte-identical declarations of the same 7-tuple, plus 6 `?? "#7C3AED"` fallbacks. `grep -roi` — **4 occurrences are lowercase**; a case-sensitive sweep misses them.

1. `src/hooks/useTeam.ts:12` — `#7C3AED` → **`#056DC5`**. Keep `#EC4899` at [1]: pink is a legitimate categorical hue once it is not the brand. Keep the array at ≥7 entries — `useProductivity.test.ts:88` asserts it, and the array is index-keyed so changing its length reassigns every person's colour.
2. `DirectView.tsx:11-13` — delete the duplicate array, `import { MEMBER_COLORS } from "@/hooks/useProductivity"` (matches `TeamSidebar.tsx:3`). Then `:397` and `:124/:125/:126` → `MEMBER_COLORS[0]`.
3. `TaskBreakdownTab.tsx:33-37` — `const TASK_PALETTE = [...MEMBER_COLORS, "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#84CC16", "#F97316", "#EF4444", "#3B82F6"];` (first 7 are already identical — pure dedupe, order preserved, no chart changes colour today).
4. Six fallbacks (`grep -rn '?? "#7C3AED"' src/` returns exactly 6): `chartShared.ts:60` → `?? MEMBER_COLORS[0]` (keep it — `Map.get` is `string | undefined`); delete the four dead ones at `DeliveryRateChart.tsx:47`, `DeliveryValueChart.tsx:62`, `HoursTrackedChart.tsx:57`, `SprintPointsChart.tsx:65` (unreachable, `noUncheckedIndexedAccess` is off); `ServicesList.tsx:483` → `?? DEPT_FALLBACK_COLORS[0]`.
5. `DeliverySpeedChart.tsx:50/:55/:57` — `MEMBER_COLORS[0]` / `MEMBER_COLORS[1]`, **and rewrite the `:63` caption** ("Pink line = …") off the colour name so it cannot drift again.
6. `ServicesList.tsx:26` → **`#033CA3`** (navy separates by lightness from the ramp's existing `#0891B2`/`#3B82F6`/`#14B8A6`); rewrite the `:22-24` comment, which currently commits the ramp to "the app's cool/violet family", and the stale `// primary violet` / `// pink` / `// light violet` labels at `:26/:30/:34`. Leave `:30`/`:34` values — categorical, not brand.

Judgement gate: after retinting, eyeball a multi-series chart. A blue-heavy 7-way palette is the real risk.

### Step 5 — Tailwind palette classes a hex grep cannot see (24 sites, 4 files, judgement)
`ParallelView.tsx:52/:54/:55/:56/:178` — 9 violet occurrences forming a 4-step density ramp. Port to an alpha ramp on one token: `bg-m-primary/25 · /45 · /70 · /95` with matching `border-m-primary/*`. The file is already half-migrated (`:51` uses `m-surface-container-high/60`). The original varies *lightness*, this varies *alpha* — **eyeball the four steps for distinguishability** before shipping; the ramp encodes data density at `ratio <= 0.33 / <= 0.66` thresholds.

Workflow indigo, 15 occurrences (`WorkflowSummaryPanel.tsx` 8, `WorkflowStepBlock.tsx` 4, `WorkflowTimeline.tsx` 3): these are **status** semantics ("in progress", "handoff/waiting"), not brand. Swap `indigo-300/400/500` → `sky-300/400/500` one-for-one to pull them into the blue family without coupling status to brand. Two exceptions: `WorkflowTimeline.tsx:57` is a link, not a status — send it to `text-m-primary`; `WorkflowSummaryPanel.tsx:54` is `from-green-400 to-indigo-400`, half status green, so handle it with the status wave (step 9) or leave it.

### Step 6 — brand assets (4 files, mechanical)
1. Rewrite `public/favicon.svg` as the concentric-arc C mark: keep `viewBox="0 0 32 32"` and the `rx="8"` plate at `x=1 y=1 w=30 h=30`, gradient `gradientUnits="userSpaceOnUse"` `x1=32 y1=0 x2=0 y2=32` with stops `#09C6F6 → #07A2E7 → #056DC5 → #033CA3`, 2–3 white `stroke-linecap="round"` arcs at ≥2.5px, gap on the right. Delete the clipboard `<rect>`/`<line>`. The current file is a `#7C4DFF → #C13AE0` clipboard — a **third** purple pair matching no token, referenced by nothing.
2. `index.html` — add `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` above `:5`, keep the PNG line below as fallback (Safari). Add `<meta name="theme-color" content="#FFFFFF" />` — the **background/surface** value, not primary, because `theme-color` must match the page's top edge (`body { @apply bg-background }`). **Ship no `prefers-color-scheme` dark variant**: nothing in `src/` ever applies the `.dark` class, so a dark tag paints near-black chrome over a white app. Skip `apple-touch-icon` (no 180×180 asset exists; the 885×885 mark has alpha 0 corners and iOS composites on black).
3. `StaffBriefForm.tsx:41-43` — replace the `<Calculator />` tile with `<img src="/conductor-mark.png" alt="Conductor" className="h-9 w-9 shrink-0 object-contain" />` (verbatim `IconRail.tsx:228`). **Remove `Calculator` from the `:1` import** — `unused-imports/no-unused-imports` is `error` (`eslint.config.js:36`), so the build fails otherwise. This is the only brand lockup in the app rendering without the mark.

### Step 7 — the design source docs (2 tracked files + 4 HTML guides, judgement)
Highest-leverage forgettable item: `CLAUDE.md` names `DESIGN.md` as the file `/impeccable` reads **first**, so leaving it violet re-injects `#7C3AED` into every future design pass.

- `DESIGN.md` (22 violet-family hex occurrences across 15 lines; 21 lines of violet prose incl. `:225`) and `.impeccable/design.json` (36 hex occurrences across 10 lines, 6 CSS snippets at `:47/:55/:63/:71/:79/:87`, palette entries at `:7/:8/:12/:13`) must be updated **together** — `document.md:244` requires it, and `hook-lib.mjs:1451` nags on mtime skew otherwise.
- `DESIGN.md` carries **no** generated banner and no script emits it, so hand-editing is legitimate and is the shortest path. If regenerating instead, the command is `/impeccable document` (not bare `/impeccable`) and it calls `AskUserQuestion` on an existing file — **never run it in a Telegram channel session**, that wedges the queue permanently.
- Re-author the display names: "Studio Violet" / "Signal Pink" / "Violet Mist" / the Reserved Gradient Rule. Re-check `DESIGN.md:139`'s rationale — teal tertiary was chosen because it is "non-violet"; that argument collapses and is replaced by the `#0F766E` hue-separation reasoning above. Re-measure the `:143` 4.5:1 claim against the new `#41536B` (7.85 — passes).
- Retint the 4 browser-facing `docs/2026-08-0*.html` guides (~40 hits) using the **full** violet family, not the 10-hex subset: `#2E1065`, `#4C1D95`, `#6D28D9`, `#A855F7` are gradient stops that a narrow pattern half-rewrites, leaving violet→blue gradients. Do `docs/2026-08-05-systems-canvas-visual-spec.html` first — 5 src files cite it as normative.
- **Leave `docs/superpowers/plans/**` and `specs/**`** — dated historical records. **Leave `design/`** — last touched 2026-06-18, superseded option explorations.

### Step 8 — red → m-error (34 sites, mechanical, unblocked)
Free and independent of everything else: the 33 `red-*` occurrences already have a live destination in `--mcolor-error` / `--mcolor-error-container`. Plus `badge.tsx:15` `destructive: "bg-rose-100 text-rose-800"` → `bg-m-error-container text-m-on-error-container` (`errorContainer #FEE2E2` vs `rose-100` and `onErrorContainer #7F1D1D` vs `rose-800` are near-identical — visually safe). Ship as its own commit.

### Step 9 — success/warning roles (222 sites, judgement, gated)
There are **255 status-hued raw classes** (amber 125, green 65, red 33, emerald 26, yellow 6) and **no token to migrate them to** — telling anyone to "use tokens" for status colour is currently an instruction they cannot follow.

Order matters:
1. Add 8 roles to `tokens/base.json` — `success`, `onSuccess`, `successContainer`, `onSuccessContainer`, `warning`, `onWarning`, `warningContainer`, `onWarningContainer`. **Each must define both `light` and `dark`** — `hexToHslTriple(pair[mode])` runs unconditionally for both modes and `hex.trim()` throws on undefined, hard-failing `npm run tokens:build`. Then `tokens:build`.
2. **Consolidate before tokenizing.** `dashboardFormat.ts` is not yet the shared formatter it looks like — it has 2 importers and 4 local duplicates. Delete the dead `scopeDot` export (`:16-20`, 0 importers), then route `DashboardProjectRow.tsx:8`, `ProjectNavRow.tsx:9`, `DashboardProjectView.tsx:54`, `ProjectScopeView.tsx:23` through it. Otherwise migrating `dashboardFormat.ts` alone leaves four copies on raw amber and the tests still pass.
3. **Decide tertiary-vs-success once, here.** `dashboardFormat.ts:17/:24/:31` already routes `on_track` to `m-tertiary` while `:45` uses raw `bg-green-500` for Xero RAG. Adding `success` without resolving that creates a third way to say the same thing. Pick: either `on_track` moves to `success`, or `success` is scoped to RAG/burn only.
4. `badge.tsx:18/:19` `success`/`warning` variants first — it is a `ui/` primitive, so three lines restyle every badge in the app. Re-count after.
5. **Update the 5 pinned test assertions in the same commit as their components**: `HoursUsedCell.test.tsx:26,41`, `StatusStrip.test.tsx:109`, `DashboardProjectRow.test.tsx:40`, `ProjectNavRow.test.tsx:43`. Better: assert on the imported map value, not a literal.

### Step 10 — Button cva sizes (1 file, additive, zero risk)
Ship first of the shape track because it is purely additive and unblocks steps 11–13. Add to `src/components/ui/button.tsx:22-27`:
- `xs: "h-7 px-3 text-label-small"` — covers the 11 text-button height overrides (`AssigneePicker.tsx:42`, `BriefConversation.tsx:135/:162/:168/:227`, `ClientHealthSection.tsx:43`, `ServicesList.tsx:666/:680/:683/:696/:699`).
- `"icon-sm": "h-8 w-8"` — 10 sites. `"icon-xs": "h-7 w-7"` — 13 sites. (h-7 w-7 is the real mode at 13; h-6 w-6 is 5. The demand is trimodal — do not guess h-6.)

`buttonVariants` has no external consumer; no test asserts a button height (every `toHaveClass` in the repo asserts colours). Caveat: `xs` at `px-3` narrows the current `sm`-inherited `px-4` by ~8px on 11 buttons — check `ServicesList.tsx:680-696` and the `max-w-56` link at `BriefConversation.tsx:135`, or set `xs` to `px-4` for a pixel-neutral migration.

### Step 11 — the field-trigger fix (2 lines, highest visible payoff)
The actual mismatch the user saw. `combobox.tsx:45` and `multi-select.tsx:59` render `<Button variant="outline">`, inheriting `rounded-full` + `px-6` at h-10, next to `Input`/`SelectTrigger`/`Textarea` at `rounded-md` + `px-3` + h-10. 5 render sites show the pill (`Clients.tsx:209` already passes `cellField` and is fine).

Both lines become `cn("w-full justify-between rounded-md bg-m-surface px-3 font-normal text-body-medium", className)`.

Do **not** rewrite as a plain `<button>` — that forfeits `forwardRef` (Radix `PopoverTrigger asChild` needs it), `disabled:pointer-events-none`, and the outline variant's hover token, for zero gain. Overrides must stay **before** `className` so `Clients.tsx:209`'s `cellField` still wins. Do not add `h-10` — it is already the default and repeating it would beat a caller's `h-9`. `text-body-medium` correctly displaces `text-label-large` via the `extendTailwindMerge` config at `src/lib/utils.ts:7-21`.

`multi-select.test.tsx` asserts only role and text content — all 7 cases survive.

### Step 12 — icon-button hit targets (2 files, a11y defect)
`dialog.tsx:41` and `sheet.tsx:62` wrap only a 16×16 `<X />` with no height, width, or padding — a **16px hit target on the close control of every dialog and sheet in the app**, below the 24px WCAG 2.2 AA minimum. Replace `"absolute right-4 top-4 rounded-sm opacity-70 …"` with `"absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full opacity-70 …"`. Keep the `sr-only` "Close" child (position:absolute, does not disturb `place-items-center`), so e2e role/name selectors are unaffected.

Also `SystemBlockNode.tsx:135` — a click-only `<span>` with no role, tabIndex or key handler, unreachable by keyboard. Its parent is a plain `<span>`, so it can become a real `<button type="button">` with an `aria-label`. `DashboardProjectRow.tsx:61` is a 20px dismiss target → `size="icon-xs"`.

Then convert the 6 already-circular sites to `size="icon-sm"`: `ProductivityControls.tsx:46/:57/:66`, `TaskBreakdownTab.tsx:156/:167/:175`. Their hover is `bg-m-surface-container` vs ghost's `bg-m-surface-container-high` — pass `className="hover:bg-m-surface-container"` if the shade shift matters.

**Do not** blanket-convert the `rounded-md` icon buttons. `ReconciliationView.tsx:366/:376` sit inside a segmented `rounded-lg` group; `IconRail.tsx:139/:327` match the nav tiles; `IconRail.tsx:243` has a conditional width; `HandoffEdge.tsx:74` is React Flow edge-midpoint geometry. `QuoteLineEditor.tsx:128` and `ScopeItemChip.tsx:85` are nested inside a `<button>` — a `<Button>` there is invalid DOM.

### Step 13 — `rounded-2xl` and bare `rounded` (54 sites, mechanical with two traps)
`rounded-2xl` is absent from `tailwind.config.ts:67-74`, so it falls through to tailwindcss 3.4.19's default `1rem` — **smaller** than `rounded-xl`'s 1.5rem. All 4 uses are in `BoardOverview.tsx`. `:80` (card) → `rounded-lg` (1rem → 1rem, pure no-op, matches `BentoOverview.tsx:53`); `:122`/`:147`/`:128` (lane containers) → `rounded-xl` to match `BentoOverview.tsx:19` — that one **is** a visual change, needs a look.

Bare `rounded` → `rounded-xs`: **50 class-string sites across 33 files**, plus 6 directional (`rounded-t` ×4, `rounded-r`, `rounded-b`). Compiles identically today (both 0.25rem) but only one is a token — the `rounded-xs` token has **0 uses**, so a Figma radius change moves nothing.

Trap: a naive word-boundary regex rewrites the JS variable `const rounded = …` at `ServicesList.tsx:51-52` and `ProcessFlow.tsx:338-340` into a syntax error. Restrict to whitespace-delimited tokens inside className strings, or hand-edit 50 sites and let `tsc -b` catch the two poisoned files.

Separately and as its own reviewed commit: `FilterRail.tsx:42` uses bare `rounded` for its checkbox box while `ui/checkbox.tsx:13` uses `rounded-sm` — two checkbox affordances, two corners. Move it to `rounded-sm`. Visible on 5 pages.

Only after this lands may anyone consider moving `borderRadius` out of `theme.extend`, and `none: "0px"` must be kept in the explicit map or the two deliberate `rounded-none` TabsList overrides break.

### Step 14 — segmented controls (11 implementations, 9 files, judgement, last)
Nine container+pill implementations in 5 distinct geometries plus 2 underline strips. Each nests correctly (outer − padding = inner, every time) — nobody made a mistake, they just never agreed on the outer. That is a governance gap, not a skill gap.

1. New presentational `src/components/ui/segmented-control.tsx` taking the `DashboardViewToggle` geometry as canonical: outer `inline-flex items-center rounded-full border border-m-outline-variant bg-m-surface-container-low p-0.5`, inner `rounded-full px-3 py-1.5 text-label-medium`, active `bg-m-surface text-m-on-surface shadow-elev-1`. Delete the inline copies at `DashboardViewToggle.tsx:21`, `OutputMultiplierShell.tsx:48` and `:67`, `TaskBreakdownTab.tsx:186`, `ProductivityControls.tsx:79`, `DirectView.tsx:74`, `Projects.tsx:213`.
2. `tabs.tsx:14` → `rounded-full` outer, `:29` → `rounded-full` trigger. **Now** — and only now — replace `data-[state=active]:bg-gradient-brand text-white` with `bg-m-surface text-m-on-surface shadow-elev-1`, so tabs match SegmentedControl. Screenshot the three `grid w-full grid-cols-N` consumers (`Approvals.tsx:235`, `StaffBriefForm.tsx:71`, `ServiceLineRow.tsx:482`) — grid beats inline-flex through tailwind-merge and stretches the pills. Add explicit `rounded-md` to `ProjectCommunications.tsx:91` (`h-auto flex-wrap` — a full-round container reads as a lozenge when wrapped).
3. Add `variant="underline"` to TabsList and route `DashboardProjectView.tsx:206`, `ProjectScopeView.tsx:218` (currently hand-written `rounded-none` overrides) plus the two real underline strips (`ProductivityPage.tsx:70-81`, `TaskBreakdownTab.tsx:205-221`) to it. Settle on `py-3`. **Carry `data-testid="productivity-tab-*"` and `"tasks-subtab-*"` onto TabsTrigger verbatim** — e2e selects on them. `smoke.spec.ts:184` asserts a tab attribute on ProjectScopeView.
4. `SystemsList.tsx` — delete `size="sm"` from **both** `:219` and `:228` so both buttons meet the h-10 TabsList. Do not shrink TabsList to h-9; that moves two page-header bands to fix one page. `RecurrencePanel.tsx:33` is a form field, not a control strip — give it `role="radiogroup"`.

### Step 15 — lint ratchets (only after the sweeps, error-from-zero)
CI runs `npx eslint . --max-warnings 47` and the repo sits at **exactly 47**. `CLAUDE.md` says do not raise the cap, and every `no-restricted-syntax` entry is `warn`. So no rule can land before its call sites are clean.

Once each sweep is at zero, add to the existing `src/**/*.{ts,tsx}` block at severity **error**:
- brand hues: `Literal[value=/\b(bg|text|border|ring|fill|stroke|from|to|via|divide)-(violet|indigo|fuchsia|purple)-\d{2,3}\b/]`
- bare rounded: `Literal[value=/(^|\s)rounded(\s|$)/]` **plus** a `TemplateElement[value.raw=…]` twin (2 sites are template literals: `FilterRail.tsx:42`, `ServicesList.tsx:249`)
- unwrapped vars: `Literal[value=/(?<!hsl\()var\(--(mcolor-|m-|surface)/]` + template twin

The rule is already `off` for tests, e2e, edge functions and `scripts/`, which is the right blast radius. For the ~222 status hues that stay legal until step 9 completes, use a standalone grep-count CI step against a committed number instead — do not route them through the warning budget. Skip the raw-`<button>` rule entirely: it would fire 69 times and is blind to 45/114 sites whose className is a `cn()`/template/array.

## 3. What must not be swept up

**Semantic colour that is not brand:**
- `badge.tsx:15/:18/:19` rose/emerald/amber — pastel state labels, deliberate, with an explanatory comment at `:12-14`. Rose moves to `m-error-container` (step 8); emerald/amber wait for the `success`/`warning` roles (step 9). Neither becomes a brand hue.
- The 15 workflow indigo sites are "in progress" / "handoff" **status**, not accent. `sky-*`, never `m-primary` — coupling status semantics to brand means the next palette change silently re-colours meaning.
- `ReconciliationView.tsx:30` `bg-blue-100 text-blue-800` is the AUTHORISED status pill. Status vocabulary, step 9.
- 262 further palette-class hits in `src/` from amber/green/red/emerald/slate/gray — status colours, mostly stay.

**Chart and categorical palettes:** the point of `MEMBER_COLORS`, `TASK_PALETTE` and `DEPT_FALLBACK_COLORS` is mutual distinguishability, not brand fidelity. Retint entry [0] only. Do not collapse `TASK_PALETTE` (15) or `DEPT_FALLBACK_COLORS` (10) into the 7-entry member array — categories collide. Do not push several entries toward blue; `#0891B2`, `#3B82F6`, `#0EA5E9` and `#06B6D4` are already in these lists and will merge.

**`chartShared.ts:13-31`** — the tooltip hexes are literal by documented decision (`:6-12` explains that Recharts renders inline styles regardless of theme). Do not "fix" them.

**`src/data/guides.ts`** — 41 gradient pairs across 7 colour-banded decks (intake blue/cyan, quoting amber, delivery green, projects pink, configuration grey). The violet and pink bands **are** the scoping and projects decks' section coding, not stray brand chrome; rotating them toward cyan collapses three decks into one hue. **Change `:735` only** — the one exact copy of the retired brand pair — and keep it a 6-digit hex, because `Guides.tsx:82` string-appends `18` as an alpha channel and any var breaks it silently into transparency.

**`gradient-gold`** (`tailwind.config.ts:106`, 1 consumer) — amber by intent. Leave it hardcoded.

**Deliberate square corners:** the two underline tab strips and every full-bleed child of an `overflow-hidden rounded-*` parent (`ServicesList.tsx:616/:637`, `BoardOverview.tsx:148`, `BucketBand.tsx:131`, `QuoteLineEditor.tsx:63`). Only 6 no-radius buttons carry a resting bg/border and **all 6 are correct**.

**Checkbox `rounded-sm` vs Switch `rounded-full`** — correct M3 and correct shadcn. Not a defect.

**Dark mode:** keep `darkMode: ["class"]` at `tailwind.config.ts:20`. Removing it flips Tailwind 3 to `media`, which would immediately activate the one orphan `dark:` variant for every OS-dark user and arm the whole 288-class light-only surface. Keep the `.dark` emitter in `build-tokens.ts` — dark values are first-class pipeline data. Just delete the orphan `dark:text-emerald-400` at `Clients.tsx:269`.

**Verified clean, nothing to do:** `scripts/build-tokens.ts` (0 hex literals — re-running it reproduces the committed output byte-for-byte, so `tokens:build` is guaranteed to propagate); `supabase/functions/**` (29 hex-bearing lines, all neutral or semantic green/amber/grey in 3 PDF renderers — no brand colour, no logo, so PDFs need no rebrand work); `e2e/` (no colour assertions, no screenshots — Playwright cannot break on this); `PRODUCT.md` (its one colour line, `:29` "no purple-gradient hero", becomes *more* apt); `index.css` (no colour literals); the 7 `rgba(255,255,255,0.06)` chart grid strokes (neutral).

## 4. Verification checklist

**Gates, after every step:**
```
npm run typecheck     # tsc -b, NOT --noEmit — the root tsconfig is references-only
npm run lint          # must stay at or under 47 warnings, 0 errors
npm run test
npm run verify        # all three
npm run lint:dead     # knip, after step 0 makes the mark visible to it
npm run tokens:build && git diff --stat src/styles/   # steps 1-2 only: must show ONLY the 2 generated files
```

**Sweep greps — all case-insensitive, 4 occurrences of `#7c3aed` are lowercase:**
```
# 0 outside docs/superpowers/ and design/
grep -rniE "#(7c3aed|8b5cf6|6366f1|4f46e5|a855f7|6750a4|d946ef|c026d3|a21caf|ec4899|e11d48|db2777|f43f5e|9f1239|ede9fe|ddd6fe|c4b5fd|a78bfa|f5f3ff|5b4a7a|7c4dff|c13ae0|e7e0ec|7d5260|b3261e)" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=test-results --exclude-dir=playwright-report

grep -rnE "\b(violet|purple|fuchsia|indigo)-[0-9]{2,3}\b" src        # 0
grep -rn '?? "#7C3AED"' src/                                          # 0
grep -rn "gradient-brand-r" . --exclude-dir=node_modules              # 0
grep -rn "var(--surface)\|--m-surface-container-high" src/            # 0
grep -rnE '[^l(]var\(--mcolor-' src --include='*.tsx' --include='*.ts' | grep -v 'hsl(var(--mcolor'   # 0
grep -rn "rounded-2xl" src/                                           # 0
rg -o --pcre2 'rounded(?![-\w:])' src -g '*.tsx'                      # 0 (excluding the 6 JS variable matches)
grep -ciE "violet|pink|7C3AED|EC4899" DESIGN.md .impeccable/design.json  # 0
git check-ignore -v public/conductor-mark.png                         # exits non-zero
git ls-files public/                                                  # 2 files
git archive HEAD public/ | tar -t                                     # lists conductor-mark.png
grep -c "gradient: \[" src/data/guides.ts                             # still 41
```

**Human visual checks — none of these are catchable by lint or tsc:**
1. **Dark mode.** No toggle exists. Run `document.documentElement.classList.add('dark')` in devtools on each surface below.
2. Primary CTA sweep in both themes: Button default, Badge default, Switch checked, Tabs active — all four resolve through `gradient-brand`.
3. The nav rail gradient border **at both `navOpen` states, both themes** — it renders for the first time after step 2, so it will look like a new element, not a fix.
4. ProgressRing at `size=44`, both the normal and `overHours` states, both themes — two arcs go from invisible to painted.
5. The ParallelView heatmap: are all four alpha steps distinguishable against `m-surface-container-high`? This is the one judgement call in step 5.
6. A multi-series productivity chart with 5+ people: does any pair of series now read as the same colour?
7. The Board view lanes (`rounded-xl` at 1.5rem vs the previous 1rem) against the Bento view.
8. The three `grid w-full grid-cols-N` TabsList consumers after step 14 — full-round corners read differently on a stretched trigger.
9. A dialog with a long title, to confirm the close button's `right-3 top-3` + 32px box lands optically where the 16px glyph was.
10. `/staff` and `/login` side by side — same lockup, same mark.
11. The `/guides` page after `:735` changes, confirming the pulse deck's three blues still separate.
12. Regenerate one real Cost Estimate PDF only if step 6's mark is ever added to it — `render-ce-pdf/index.ts:74` positions the footer absolutely at `bottom: 30` while the body flows, so a taller header can break the deliberate two-page structure.