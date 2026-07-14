---
name: Conductor
description: The agency operations command center for Converted Click — a warm, capable studio surface.
colors:
  primary: "#7C3AED"
  primary-pink: "#EC4899"
  on-primary: "#FFFFFF"
  primary-container: "#EDE9FE"
  on-primary-container: "#2E1065"
  secondary: "#475569"
  tertiary: "#0891B2"
  error: "#DC2626"
  ink: "#09090B"
  surface: "#FFFFFF"
  surface-container-low: "#FAFAFA"
  surface-container: "#F5F3FF"
  surface-container-high: "#EDE9FE"
  outline: "#C4B5FD"
  muted-ink: "#5B4A7A"
  gold: "#F59E0B"
  dark-surface: "#09090B"
  dark-primary: "#A78BFA"
  dark-surface-container: "#18181B"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "3.5625rem"
    fontWeight: 400
    lineHeight: 1.123
    letterSpacing: "-0.016em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.27
    letterSpacing: "0em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0.018em"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
    letterSpacing: "0.007em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0em"
rounded:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    padding: "8px 24px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "8px 24px"
  button-secondary:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    rounded: "{rounded.full}"
    padding: "8px 24px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
---

# Design System: Conductor

## 1. Overview

**Creative North Star: "The Warm Studio"**

Conductor is where Converted Click runs its business, and it should feel like the agency's own studio surface — human, considered, a little crafted — not a piece of generic internal software. The system is built on Material 3 role-based tokens (violet primary, Inter type, a five-step tonal surface ramp) synced from Figma. Warmth lives in the copy, the empty states, and the small moments of feedback; precision lives in the numbers, the tables, and the money-bearing flows. The signature move is a violet→pink brand gradient (`#7C3AED → #EC4899`) held in reserve for primary actions and identity moments — never sprayed across the surface as decoration.

This is a **product** register: design serves the task. The people using it are expert operators who return daily, so density and speed win over onboarding theatre — but the tool stays legible and unhurried rather than cramped. Components are soft and approachable: full-round pill buttons, generous padding, gently rounded cards that rest on a soft shadow so the interface feels tactile and alive rather than flat and clinical.

It explicitly rejects three things, carried straight from PRODUCT.md: **enterprise/SAP heaviness** (gray, joyless, form-on-every-screen legacy admin), the **generic AI-SaaS template** (purple-gradient hero, identical card grids, tiny tracked eyebrows, big-number-metric clichés), and **spreadsheet sprawl** (raw hierarchy-less grids — the exact mess Conductor exists to replace). The brand gradient is deliberate signature, not the SaaS-cliché; the distinction is discipline about where it appears.

**Key Characteristics:**
- Violet-forward Material 3 palette with a violet→pink gradient reserved for primary actions
- Inter as the single UI family across display, headings, labels, body, and data; JetBrains Mono for figures/code
- Fixed rem type scale (not fluid) — product density, consistent DPI
- Soft, full-round controls and gently lifted cards; warm, not clinical
- Light and dark modes, both first-class; WCAG AA baseline

## 2. Colors

A violet-anchored palette: one confident brand hue, warm violet-tinted neutrals for layering, and a small semantic vocabulary for state. Restrained by default — the accent earns its rarity.

### Primary
- **Studio Violet** (`#7C3AED`, `--primary` / `--mcolor-primary`): The brand anchor. Primary buttons, current selection, focus rings, active nav, links. Paired with **Signal Pink** (`#EC4899`) it forms the `bg-gradient-brand` (`linear-gradient(135deg, #7C3AED, #EC4899)`) — the identity gradient on primary CTAs only.
- **Violet Container** (`#EDE9FE`, `--primary-container`): Tinted fill for selected states, secondary buttons, subtle brand-tinted zones. Text on it uses **Deep Indigo** (`#2E1065`).

### Secondary
- **Slate** (`#475569`, `--mcolor-secondary`): Cooler neutral for secondary emphasis, muted controls, and the toolbar/panel layer that sits apart from content.

### Tertiary
- **Teal** (`#0891B2`, `--mcolor-tertiary`): Sparingly, for informational accents and data-viz differentiation where a non-violet hue reads clearer.

### Neutral
- **Ink** (`#09090B`, `--foreground` / `--mcolor-on-surface`): Primary text. Near-black, effectively neutral. Body copy sits here, not in a muted gray — legibility first.
- **Muted Ink** (`#5B4A7A`, `--muted-foreground`): Secondary text, placeholders, captions — a violet-tinted mid, not a washed gray. Must still clear 4.5:1 on light surfaces.
- **Surface** (`#FFFFFF`, `--surface`): Content background and card fills.
- **Surface Container Low** (`#FAFAFA`, `--surface-container-low`): The app-shell backdrop behind content.
- **Surface Container** (`#F5F3FF`) / **High** (`#EDE9FE`): Violet-tinted layering for panels, hovers, and raised zones — depth by tone, not just shadow.
- **Outline** (`#C4B5FD`, `--input` / `--mcolor-outline`): Violet-tinted borders and dividers. Outline Variant (`#EDE9FE`) for the lightest hairlines.

### Semantic
- **Error** (`#DC2626`, `--destructive`): Destructive actions, validation errors, over-budget signals. **Gold** (`#F59E0B`, `bg-gradient-gold`) for warnings/highlights and celebratory financial moments.

### Named Rules
**The Reserved Gradient Rule.** The violet→pink `bg-gradient-brand` appears only on primary actions and identity moments. It is never a section background, never a hero wash, never decorative. Its scarcity is what keeps it from reading as the AI-SaaS cliché the brand rejects.

**The Ink-Not-Gray Rule.** Body text is Ink (`#09090B`), never a light elegance-gray. Secondary text is violet-tinted Muted Ink and still clears 4.5:1. Light-gray-for-refinement is prohibited — it is the top reason internal tools feel hard to read.

## 3. Typography

**Display / Body / Label Font:** Inter (with `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto` fallback)
**Mono Font:** JetBrains Mono (with `ui-monospace, SFMono-Regular, Menlo` fallback)

**Character:** One warm, humanist sans carries the entire UI — headings, buttons, labels, body, and data — for a coherent, unfussy voice. JetBrains Mono is the deliberate second voice, reserved for figures, IDs, currency amounts, and code so numbers align and read as precise. This is a single-family product system by design: no display/body pairing, no exaggerated contrast.

### Hierarchy
- **Display** (400, 3.5625rem / 57px, lh 4rem, ls -0.016em): `text-display-large`. Rare — big empty-state or landing moments only, never inside dense screens.
- **Headline** (600, 2rem / 32px, lh 2.5rem): `text-headline-large`. Page titles, primary section headers.
- **Title** (600, 1.375rem→1rem): `text-title-large/medium/small`. Card headers, panel titles, table-group labels.
- **Body** (400, 0.875rem / 14px, lh 1.25rem, ls 0.018em): `text-body-medium`. Default UI text and prose. Cap prose at 65–75ch; tables may run denser.
- **Label** (500, 0.875rem, ls 0.007em): `text-label-large`. Buttons, form labels, nav, chips. `text-label-medium` on small controls.

### Named Rules
**The Numbers-Are-Mono Rule.** Currency, hours, percentages, and IDs render in JetBrains Mono so figures tabulate and read as exact. Money is the product's core; its typography signals trust.

**The Fixed-Scale Rule.** The type scale is fixed rem, never fluid `clamp()`. A heading that shrinks inside a sidebar looks worse, not better — product density depends on consistent sizing across every panel.

## 4. Elevation

Gently lifted. Cards and panels carry a soft resting shadow (`--elevation-level1`, a barely-there slate-tinted `0 1px 2px rgb(15 23 42 / 0.04)`) so the interface feels tactile rather than flat, while depth is *also* carried by the violet-tinted surface ramp. Interactive lift (hover, popover, dropdown, modal) steps up the ramp (`elev-2` through `elev-5`). Shadows are slate-tinted, low-opacity, and diffuse — never dark or hard.

### Shadow Vocabulary
- **elev-1** (`0 1px 2px 0 rgb(15 23 42 / 0.04)`): Resting state for cards and panels.
- **elev-2** (`0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px …`): Hover on cards/buttons, subtle raise.
- **elev-3 / elev-4** (`0 4px 6px…` / `0 10px 15px…`): Dropdowns, popovers, floating toolbars.
- **elev-5** (`0 20px 25px -5px rgb(15 23 42 / 0.1) …`): Modals and command palette — the top of the stack.

### Named Rules
**The Soft-Shadow Rule.** Shadows are slate-tinted and low-opacity, layered subtly — never a hard 2014-era drop shadow. Test: if the shadow reads as a distinct gray edge rather than diffuse depth, it is too dark.

## 5. Components

Soft and approachable, on a consistent, familiar affordance vocabulary. Same button shape, same form-control language, same icon style (Lucide) across every screen.

### Buttons
- **Shape:** Full-round pill (`rounded-full`, 9999px) — the signature control shape.
- **Primary:** `bg-gradient-brand` (violet→pink) + white `text-label-large`, `shadow-elev-1`, `h-10 px-6`. Hover brightens (`brightness-110`) and lifts to `elev-2`; active dims (`brightness-95`).
- **Secondary:** Violet container fill (`bg-m-secondary-container`) + on-container text; hover softens opacity.
- **Outline:** 1px violet outline (`border-m-outline`), transparent fill, `text-m-on-surface`; hover fills to `surface-container-high`.
- **Ghost / Link:** No fill; ghost hovers to `surface-container-high`, link underlines on hover.
- **Focus:** `ring-2 ring-ring ring-offset-2` (violet ring). Disabled drops to 50% opacity, pointer-events off.
- **Sizes:** `sm` h-8 / `default` h-10 / `lg` h-11 / `icon` 10×10.

### Cards / Containers
- **Corner Style:** `rounded-lg` (1rem / 16px) — generously soft.
- **Background:** `bg-card` (white light / near-black dark).
- **Shadow Strategy:** Resting `shadow-elev-1` (see Elevation) — gently lifted.
- **Border:** 1px `border-m-outline-variant` (lightest violet hairline).
- **Internal Padding:** 24px (lg). Never nest cards inside cards.

### Inputs / Fields
- **Style:** `rounded-md` (0.75rem), 1px `border-m-outline`, `bg-m-surface`, `h-10`, `text-body-medium`.
- **Placeholder:** `text-m-on-surface-variant` (must clear 4.5:1 — no faint gray).
- **Focus:** `ring-2 ring-ring` with border going transparent — a violet glow, not a border jump.
- **Disabled:** 50% opacity, `cursor-not-allowed`.

### Navigation
- App-shell with a persistent side nav over a `bg-m-surface-container-low` backdrop. Active item carries the violet accent (primary text / tinted fill); hover raises to `surface-container-high`. Labels use `text-label-large`. Nav collapses structurally at breakpoints — never via fluid type.

### Data Tables
- The signature product surface (TanStack Table). Dense rows, mono-set figures, restrained row hierarchy (grouping, zebra-free tonal separation) — structure over grid-sprawl. Right-align numeric columns; keep money in JetBrains Mono.

## 6. Do's and Don'ts

### Do:
- **Do** reserve the violet→pink `bg-gradient-brand` for primary actions and identity moments only — its scarcity is the point.
- **Do** set body text in Ink (`#09090B`) and keep secondary text at violet-tinted Muted Ink that clears 4.5:1.
- **Do** use full-round pills for buttons and `rounded-lg` cards with a soft `elev-1` resting shadow — warm, tactile, not flat.
- **Do** render currency, hours, and IDs in JetBrains Mono so figures tabulate and read as exact.
- **Do** bring hierarchy to dense data — group, summarize, right-align numbers — instead of shipping raw grids.
- **Do** use the `m-` / shadcn token classes (`bg-m-surface`, `text-m-on-surface-variant`, `bg-primary`) — never hardcoded hex. Tokens are Figma-synced and generated.
- **Do** provide every interactive state (default, hover, focus-visible, active, disabled, loading, error) and teach-the-interface empty states.

### Don't:
- **Don't** recreate **enterprise/SAP heaviness** — gray, joyless, form-on-every-screen legacy admin. Warmth and hierarchy are non-negotiable.
- **Don't** ship the **generic AI-SaaS template**: no purple-gradient hero wash, no identical icon+heading+text card grids, no tiny uppercase tracked eyebrows above sections, no big-number-metric hero cliché.
- **Don't** allow **spreadsheet sprawl** — raw, hierarchy-less grids are the exact mess Conductor replaces; structure the data or don't show it.
- **Don't** use light "elegance gray" for body text, or faint placeholders below 4.5:1.
- **Don't** hand-edit `src/styles/tokens.css` or `src/styles/tokens.ts` — they're generated from `tokens/base.json` (run `npm run tokens:build`).
- **Don't** use fluid `clamp()` heading scales, hard/dark drop shadows, side-stripe `border-left` accents, gradient text, or default glassmorphism.
- **Don't** nest cards, or reach for a modal before exhausting inline/progressive alternatives.
