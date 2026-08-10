# Control shape rule

Conductor shipped 26 distinct control geometries — six different radii on
buttons alone, filter chips in six variants, tabs in two shapes, inputs at
three heights. This is the rule that replaced them. It is structural only: no
colour token, gradient or palette value changed when it was applied.

## The radius scale

Derived from a single base, shadcn-style. `tokens/base.json` → `radius`:

| token | value | px | used for |
| --- | --- | --- | --- |
| `xs` | 0.125rem | 2 | hairline accents |
| `sm` | 0.2rem | 3.2 | dropdown menu items, data-viz cells |
| `md` | 0.325rem | 5.2 | **fields** |
| `lg` | 0.45rem | 7.2 | **nested surfaces** — the base |
| `xl` | 0.7rem | 11.2 | **top-level containers** |
| `full` | 9999px | — | **actions and chips** |

`--radius` (the bare shadcn variable) points at `lg`, the base. It previously
pointed at `md`, which made the one knob shadcn components reach for disagree
with the scale it was supposed to anchor.

## The five roles

1. **Actions** — you click it, something happens → `rounded-full`.
   Heights `h-7` (28) / `h-8` (32) / `h-10` (40). Icon-only actions are square:
   `h-8 w-8` or `h-10 w-10`, still pill. Prefer the `Button` component.
2. **Fields** — you type in it or pick a value → `rounded-md`, `h-10`.
   `Combobox` and `MultiSelect` borrow `Button` for its outline styling, so they
   carry an explicit `rounded-md` override — they are fields, not actions, and
   a pill trigger beside a `rounded-md` `Input` was the most visible defect in
   the old UI.
3. **Chips / badges / filter toggles** → `rounded-full`, `h-6` (24) inline or
   `h-7` (28) in a filter rail.
4. **Containers** — cards, dialogs, sheets, popovers, dropdown surfaces →
   `rounded-xl`; a surface nested inside another container → `rounded-lg`.
5. **Row triggers** — full-width, multi-line clickable rows with a hover fill →
   they follow their container, never a pill. A pill on a 64px table row reads
   as broken. This role was discovered during the sweep; it is why some
   `<button>`s legitimately carry no radius class.

**Rule ordering matters:** a role rule always beats the retirement rule below.
The first sweep converted three status chips to `rounded-sm` because they had
used bare `rounded`; role (chip → pill) should have won and now does.

## Retired

- bare `rounded` — untokenized Tailwind `0.25rem`, does not track the base. **0 left.**
- `rounded-2xl` — not in the scale, silently falls through to Tailwind's default. **0 left.**
- arbitrary `rounded-[Npx]`. **0 left.**

## Deliberate exemptions

- `rounded-none` survives on exactly two page-level underline tab bars
  (`DashboardProjectView.tsx`, `ProjectScopeView.tsx`) — section navigation, not
  a segmented control.
- Circles by nature — avatars, progress rings, dots, spinners — keep
  `rounded-full` regardless of role.
- Dropdown **menu items** stay `rounded-sm`, following shadcn's own convention.
  They are actions, but pilling a menu row looks wrong.
- Directional radii (`rounded-t`, `rounded-r`, `rounded-b`) survive on six
  decorative chart bars and accent ticks. Same untokenized default as bare
  `rounded`, but they are data-viz, not controls.
- The Clients table's inline cell editors strip `h-10`/`px-3`/`bg` from `Input`
  at the call site to read as plain table cells. Their radius matches every
  other field; only their height (36) sits off the scale. Left deliberately —
  normalising it changes the table's row rhythm.

## Known hazard — the Figma sync

`tokens/base.json` is the Figma-synced source of truth. `sync-figma-tokens.ts`
merges Figma's values over `meta`, `color` and `radius`:

```ts
radius: Object.keys(radius).length > 0 ? { ...existing.radius, ...radius } : existing.radius,
```

Radius is only clobbered **if the Figma file actually defines `radius/*` FLOAT
variables**. Today `meta.figmaFileKey` is `null` and `meta.source` is `"seed"`,
so nothing is at risk. **Before connecting Figma, seed its `radius/*` variables
from the table above**, or the next `npm run tokens:sync` restores the old
scale and leaves every reclassified class behind — a geometry nobody chose.

The `gradient` group is not in that merge list, so it survives sync untouched.

## Gradients are tokens now

`gradient-brand`, `gradient-brand-r` and `gradient-gold` were hardcoded hex in
`tailwind.config.ts` — the only colour left outside the token pipeline, and
therefore unreachable by `tokens:sync`. They now live in `tokens/base.json`
under a top-level `gradient` group of finished CSS strings, emitted as
`--gradient-*` and consumed via the generated `gradients` export.

They are **not** under `color` on purpose: `hexToHslTriple` throws on anything
that is not `#RRGGBB`.

Values were moved verbatim — nothing renders differently.
