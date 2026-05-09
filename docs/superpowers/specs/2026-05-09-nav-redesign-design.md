# Nav Redesign — Design Spec

**Date:** 2026-05-09  
**Status:** Approved

## Summary

Split the current monolithic sidebar into three persistent zones: a narrow icon rail, a permanent client/project sidebar, and the main content area. The primary navigation (Dashboard, Inbox, Services, etc.) becomes a slide-over overlay triggered from the icon rail, keeping the client list always visible as the primary contextual anchor.

## Layout

Fixed three-column grid — never changes regardless of nav state:

```
[56px icon rail] [200px client sidebar] [1fr main content]
```

The grid columns are defined in `AppShell` and do not shift when the nav opens or closes.

## Icon Rail (56px, always visible)

Contains, top to bottom:

1. **App logo icon** — calculator icon in `bg-m-primary-container`, no label
2. **Chevron toggle** — `›` when closed, `‹` when open; clicking toggles the nav overlay
3. **Nav icons** — one icon per nav item (Dashboard, Inbox, Services, Clients, Projects, Rules, Departments, Team, Guides, Settings); clicking navigates directly without opening the overlay; active page icon gets `bg-m-primary-container` highlight
4. **Tooltip on hover** — each icon shows a label tooltip (`title` attribute or Radix `Tooltip`) so the label is always discoverable without opening the overlay
5. **Sign-out icon** — pinned to the bottom (`margin-top: auto`)

## Client/Project Sidebar (200px, always visible)

Occupies the second column at all times. Contains:

- Section header: "CLIENTS & PROJECTS" label
- `InboxNavSection` (unlinked briefs, if any)
- `ClientNavSection` per client — only clients with at least one `in_progress` project, same collapsible behaviour as today
- Scrollable (`overflow-y: auto`)
- No sign-in footer (moved to icon rail bottom)

## Nav Overlay

**Trigger:** chevron in icon rail  
**Position:** `position: fixed; left: 56px; top: 0; bottom: 0; width: 220px; z-index: 50`  
**Appearance:** white background, `shadow-elev-3`, 2px indigo left border  
**Contents:** full nav list with icon + label, same active state as today (pill highlight)  
**Close:** clicking the chevron again, pressing Escape, or clicking the scrim  
**Scrim:** `position: fixed; inset: 0; left: 56px; z-index: 40; background: rgba(0,0,0,0.2)` — sits behind the overlay, in front of client sidebar and main content

**Transition:** `translate-x-0 ↔ -translate-x-full` + `opacity-100 ↔ opacity-0` on both overlay and scrim, ~200ms ease-out via Tailwind `transition-[transform,opacity]`.

## State Management

Single `navOpen: boolean` state in `AppShell`. No persistence — collapses to icon rail on every page load. `useEffect` adds/removes an `Escape` keydown listener when `navOpen` is true.

## Component Changes

| File | Change |
|------|--------|
| `AppShell.tsx` | Grid → `grid-cols-[56px_200px_1fr]`; add `navOpen` state; render icon rail, client sidebar, overlay, scrim |
| `ClientNavSection.tsx` | No changes |
| `InboxNavSection.tsx` | No changes |
| New: `NavOverlay.tsx` | Overlay panel + scrim as a single component receiving `open`, `onClose`, `currentPath` props |
| New: `IconRail.tsx` | Icon rail column receiving `navOpen`, `onToggle`, nav items array |

## Out of Scope

- Persisting open/closed state across sessions
- Animating the client sidebar width
- Mobile/responsive behaviour
- Any change to nav items or routes
