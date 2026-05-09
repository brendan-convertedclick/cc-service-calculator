# Nav Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic sidebar with a 56px icon rail + 200px permanent client sidebar, with the primary nav becoming a fixed-position overlay triggered by a chevron in the icon rail.

**Architecture:** Three-column fixed grid (`56px 200px 1fr`). `IconRail` handles direct icon navigation with tooltips and the chevron toggle. `NavOverlay` renders the full nav as a fixed panel + scrim over both the client sidebar and main content. `AppShell` holds `navOpen` state and wires everything together.

**Tech Stack:** React 18, React Router v6 (`NavLink`, `useLocation`), Tailwind CSS, Radix UI Tooltip (`@radix-ui/react-tooltip` already installed), Vitest + React Testing Library.

**Run tests:** `npm test` (single run) or `npm run test:watch` (watch mode)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/ui/tooltip.tsx` | Thin shadcn-style wrapper around Radix Tooltip |
| Create | `src/components/nav/navItems.ts` | Shared nav item definitions (icon, label, route) |
| Create | `src/components/nav/IconRail.tsx` | 56px icon rail: logo, chevron, icons, sign-out |
| Create | `src/components/nav/IconRail.test.tsx` | Unit tests for IconRail |
| Create | `src/components/nav/NavOverlay.tsx` | Full nav overlay + scrim |
| Create | `src/components/nav/NavOverlay.test.tsx` | Unit tests for NavOverlay |
| Modify | `src/components/AppShell.tsx` | Updated grid, navOpen state, composed layout |

---

## Task 1: Tooltip component

**Files:**
- Create: `src/components/ui/tooltip.tsx`

- [ ] **Step 1: Create the tooltip component**

```tsx
// src/components/ui/tooltip.tsx
import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-m-on-surface px-2.5 py-1 text-label-small text-m-surface shadow-elev-2 animate-in fade-in-0 zoom-in-95",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/tooltip.tsx
git commit -m "feat(ui): add Tooltip component wrapping Radix"
```

---

## Task 2: Nav items constant

**Files:**
- Create: `src/components/nav/navItems.ts`

- [ ] **Step 1: Create the shared nav items array**

```ts
// src/components/nav/navItems.ts
import {
  BookOpen,
  Building2,
  FolderKanban,
  LayoutDashboard,
  Inbox as InboxIcon,
  PackageSearch,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Users,
  Workflow,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

export const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, end: false },
  { to: "/services", label: "Services", icon: PackageSearch, end: false },
  { to: "/clients", label: "Clients", icon: Building2, end: false },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/rules", label: "Rules", icon: SlidersHorizontal, end: false },
  { to: "/departments", label: "Departments", icon: Workflow, end: false },
  { to: "/team", label: "Team", icon: Users, end: false },
  { to: "/guides", label: "Guides", icon: BookOpen, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/components/nav/navItems.ts
git commit -m "feat(nav): extract shared navItems constant"
```

---

## Task 3: IconRail — tests first

**Files:**
- Create: `src/components/nav/IconRail.test.tsx`
- Create: `src/components/nav/IconRail.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/nav/IconRail.test.tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { IconRail } from "./IconRail"
import { vi } from "vitest"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe("IconRail", () => {
  it("renders all nav item icons with aria-labels", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /inbox/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument()
  })

  it("shows open chevron aria-label when navOpen is false", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument()
  })

  it("shows close chevron aria-label when navOpen is true", () => {
    render(<IconRail navOpen={true} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /close navigation/i })).toBeInTheDocument()
  })

  it("calls onToggle when chevron is clicked", () => {
    const onToggle = vi.fn()
    render(<IconRail navOpen={false} onToggle={onToggle} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("renders sign-out button", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npm test -- IconRail
```

Expected: FAIL — `IconRail` does not exist yet.

- [ ] **Step 3: Create IconRail component**

```tsx
// src/components/nav/IconRail.tsx
import { Calculator, ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import { NavLink, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { navItems } from "./navItems"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface IconRailProps {
  navOpen: boolean
  onToggle: () => void
}

export function IconRail({ navOpen, onToggle }: IconRailProps) {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex flex-col items-center border-r border-m-outline-variant bg-m-surface py-3 gap-1">
        {/* Logo */}
        <div className="grid h-9 w-9 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container mb-1">
          <Calculator className="h-[18px] w-[18px]" />
        </div>

        {/* Chevron toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggle}
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              className="grid h-8 w-9 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors mb-2"
            >
              {navOpen ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {navOpen ? "Close menu" : "Open menu"}
          </TooltipContent>
        </Tooltip>

        {/* Nav icons */}
        {navItems.map((item) => (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                end={item.end}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    "grid h-9 w-9 place-items-center rounded-md transition-colors",
                    isActive
                      ? "bg-m-primary-container text-m-on-primary-container"
                      : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
                  )
                }
              >
                <item.icon className="h-[18px] w-[18px]" />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}

        {/* Sign out — pinned to bottom */}
        <div className="mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Sign out"
                onClick={async () => {
                  await signOut()
                  navigate("/login", { replace: true })
                }}
                className="grid h-9 w-9 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npm test -- IconRail
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/IconRail.tsx src/components/nav/IconRail.test.tsx
git commit -m "feat(nav): add IconRail with tooltips and chevron toggle"
```

---

## Task 4: NavOverlay — tests first

**Files:**
- Create: `src/components/nav/NavOverlay.test.tsx`
- Create: `src/components/nav/NavOverlay.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/nav/NavOverlay.test.tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { NavOverlay } from "./NavOverlay"
import { vi } from "vitest"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe("NavOverlay", () => {
  it("is not visible when open is false", () => {
    render(<NavOverlay open={false} onClose={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.queryByRole("navigation")).not.toBeVisible()
  })

  it("is visible when open is true", () => {
    render(<NavOverlay open={true} onClose={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("navigation")).toBeVisible()
  })

  it("renders all nav item labels when open", () => {
    render(<NavOverlay open={true} onClose={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Inbox")).toBeInTheDocument()
    expect(screen.getByText("Settings")).toBeInTheDocument()
  })

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={true} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("calls onClose when scrim is clicked", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={true} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByTestId("nav-scrim"))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("does not attach Escape listener when closed", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={false} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npm test -- NavOverlay
```

Expected: FAIL — `NavOverlay` does not exist yet.

- [ ] **Step 3: Create NavOverlay component**

```tsx
// src/components/nav/NavOverlay.tsx
import { useEffect } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { navItems } from "./navItems"

interface NavOverlayProps {
  open: boolean
  onClose: () => void
}

export function NavOverlay({ open, onClose }: NavOverlayProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  return (
    <>
      {/* Scrim */}
      <div
        data-testid="nav-scrim"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={{ left: 56 }}
      />

      {/* Overlay panel */}
      <nav
        aria-label="Main navigation"
        className={cn(
          "fixed top-0 bottom-0 z-50 w-[220px] bg-m-surface border-r-2 border-m-primary shadow-elev-3",
          "flex flex-col gap-0.5 px-3 pt-4 pb-3",
          "transition-[transform,opacity] duration-200 ease-out",
          open
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none"
        )}
        style={{ left: 56 }}
      >
        <p className="px-3 pb-2 text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Navigation
        </p>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-full px-4 py-2.5 text-label-large transition-colors",
                isActive
                  ? "bg-m-primary-container text-m-on-primary-container"
                  : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npm test -- NavOverlay
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/NavOverlay.tsx src/components/nav/NavOverlay.test.tsx
git commit -m "feat(nav): add NavOverlay with scrim and Escape-to-close"
```

---

## Task 5: Update AppShell

**Files:**
- Modify: `src/components/AppShell.tsx`

- [ ] **Step 1: Replace AppShell with the new three-column layout**

Replace the entire contents of `src/components/AppShell.tsx` with:

```tsx
// src/components/AppShell.tsx
import { useState } from "react"
import { Outlet } from "react-router-dom"
import { InboxAssignModal } from "@/components/scope/InboxAssignModal"
import { useClientProjects } from "@/hooks/useClientProjects"
import { ClientNavSection } from "@/components/nav/ClientNavSection"
import { InboxNavSection } from "@/components/nav/InboxNavSection"
import { IconRail } from "@/components/nav/IconRail"
import { NavOverlay } from "@/components/nav/NavOverlay"
import type { Database } from "@/types/db"

type Brief = Database["public"]["Tables"]["briefs"]["Row"]

export function AppShell() {
  const { data: clientsWithProjects = [] } = useClientProjects()
  const [inboxBrief, setInboxBrief] = useState<Brief | null>(null)
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-screen grid grid-cols-[56px_200px_1fr] bg-m-surface-container-low">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: client/project sidebar */}
      <aside className="flex flex-col border-r border-m-outline-variant bg-m-surface overflow-y-auto">
        <div className="px-3 pt-4 pb-2">
          <p className="px-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
            Clients &amp; Projects
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-3">
          <InboxNavSection onSelectBrief={(b) => setInboxBrief(b)} />

          {clientsWithProjects
            .filter((client) =>
              client.projects.some((p) => p.status === "in_progress")
            )
            .map((client) => (
              <ClientNavSection key={client.id} client={client} />
            ))}
        </nav>
      </aside>

      {/* Column 3: main content */}
      <main className="flex min-h-screen flex-col overflow-auto">
        <Outlet />
      </main>

      {/* Nav overlay + scrim (rendered over columns 2 and 3) */}
      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />

      {inboxBrief && (
        <InboxAssignModal
          brief={inboxBrief}
          open={!!inboxBrief}
          onClose={() => setInboxBrief(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all existing tests still pass, plus the new IconRail and NavOverlay tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "feat(nav): update AppShell to three-column layout with nav overlay"
```

---

## Task 6: Browser smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:5174`. Sign in as `team@convertedclick.co.za` / `cc-calc-2026-temp`.

- [ ] **Step 2: Verify collapsed state**

Check:
- Left column is ~56px wide with just icons
- Middle column shows client/project list
- Hovering a nav icon shows a tooltip label
- Clicking an icon navigates to the correct page without opening the overlay

- [ ] **Step 3: Verify overlay open state**

Check:
- Clicking the chevron (`›`) opens the full nav overlay
- Overlay slides in from the left (over client sidebar and content)
- Scrim darkens everything to the right of the icon rail
- Chevron flips to `‹`

- [ ] **Step 4: Verify overlay close behaviours**

Check all three close paths:
- Click the chevron again → overlay closes
- Click anywhere on the scrim → overlay closes
- Press Escape → overlay closes

- [ ] **Step 5: Commit if no issues, otherwise fix and re-commit**

```bash
git add -p   # stage any fix-up changes
git commit -m "fix(nav): address smoke-test issues"
```

If no issues, no extra commit needed.
