import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { Bug, ChevronDown, ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { memberColors, useTeam } from "@/hooks/useTeam"
import { useCurrentRole } from "@/hooks/useCurrentRole"
import {
  navEntriesFor,
  type NavItem,
  type NavSection,
} from "./navItems"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { FeedbackDialog } from "@/components/FeedbackDialog"

const NavRow = forwardRef<
  HTMLAnchorElement,
  { item: NavItem; navOpen: boolean; indent?: boolean } & React.HTMLAttributes<HTMLAnchorElement>
>(function NavRow({ item, navOpen, indent = false, ...rest }, ref) {
  const { pathname } = useLocation()
  const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to)

  return (
    <NavLink
      ref={ref}
      to={item.to}
      end={item.end}
      aria-label={item.label}
      {...rest}
      className={cn(
        "flex items-center shrink-0 transition-all duration-200 ease-out",
        navOpen
          ? cn(
              "w-full gap-3 rounded-md py-1.5 text-label-medium tracking-normal",
              indent ? "pl-6 pr-3" : "px-3",
              isActive
                ? "bg-gradient-brand text-white"
                : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface",
            )
          : cn(
              "h-10 w-10 justify-center rounded-md",
              isActive
                ? "bg-gradient-brand text-white shadow-sm"
                : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface",
            ),
      )}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      <span
        className={cn(
          "whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-200 ease-out",
          navOpen ? "opacity-100 max-w-[200px]" : "opacity-0 max-w-0",
        )}
      >
        {item.label}
      </span>
    </NavLink>
  )
})

function SectionGroup({ section }: { section: NavSection }) {
  const { pathname } = useLocation()
  const hasActiveChild = section.items.some((it) =>
    it.end ? pathname === it.to : pathname.startsWith(it.to),
  )
  const [open, setOpen] = useState(hasActiveChild)
  // Auto-expand when navigating into a child, but allow the user to collapse
  // afterwards (don't keep forcing it open while the child stays active).
  useEffect(() => {
    if (hasActiveChild) setOpen(true)
  }, [hasActiveChild])
  const Icon = section.icon

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={section.label}
        className="flex items-center w-full gap-3 rounded-md px-3 py-1.5 text-label-medium tracking-normal transition-all duration-200 ease-out shrink-0 text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 text-left whitespace-nowrap">{section.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {open &&
        section.items.map((item) => (
          <NavRow key={item.to} item={item} navOpen={true} indent />
        ))}
    </div>
  )
}

// Collapsed-rail counterpart to SectionGroup: a single section icon that
// reveals its children in a hover/click flyout, so the rail shows the same
// nine entries as the expanded nav (4 top + 4 sections + Settings) rather than
// flattening every child into the rail.
function CollapsedSection({ section }: { section: NavSection }) {
  const { pathname } = useLocation()
  const hasActiveChild = section.items.some((it) =>
    it.end ? pathname === it.to : pathname.startsWith(it.to),
  )
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const Icon = section.icon

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  // Small grace period so moving the cursor from the icon across the gap to the
  // flyout doesn't dismiss it.
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  useEffect(() => cancelClose, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={section.label}
          onMouseEnter={() => {
            cancelClose()
            setOpen(true)
          }}
          onMouseLeave={scheduleClose}
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-md transition-colors",
            hasActiveChild
              ? "bg-gradient-brand text-white shadow-sm"
              : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className="w-56 p-1.5"
      >
        <p className="px-3 pb-1.5 pt-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
          {section.label}
        </p>
        <div className="flex flex-col gap-0.5">
          {section.items.map((item) => (
            <NavRow
              key={item.to}
              item={item}
              navOpen={true}
              onClick={() => setOpen(false)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface IconRailProps {
  navOpen: boolean
  onToggle: () => void
}

export function IconRail({ navOpen, onToggle }: IconRailProps) {
  const { signOut, currentUserId, user } = useAuth()
  const { data: team = [] } = useTeam()
  const { role } = useCurrentRole()
  const entries = navEntriesFor(role)
  const navigate = useNavigate()
  const [reporting, setReporting] = useState(false)

  // Who's signed in — resolved from the team roster (falls back to the auth
  // email, e.g. the shared team@ login which has no roster row).
  const me = team.find((m) => m.id === currentUserId)
  const displayName = me?.full_name ?? user?.email ?? "Signed in"
  const initials = (
    me?.full_name
      ? me.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("")
      : (user?.email?.[0] ?? "?")
  ).toUpperCase()

  // A face keeps the same colour everywhere it appears. Undefined for the
  // shared team@ login, which has no roster row — that falls back to the
  // neutral container tint rather than borrowing someone else's colour.
  const myColor = useMemo(() => (me ? memberColors(team).get(me.id) : undefined), [team, me])

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "flex flex-col bg-m-surface py-3 gap-1 transition-all duration-200 ease-out overflow-hidden shrink-0",
          navOpen ? "w-[220px] items-stretch px-3" : "w-[56px] items-center border-r border-m-outline-variant",
        )}
        style={
          navOpen
            ? {
                borderRight: "2px solid transparent",
                backgroundClip: "padding-box, border-box",
                backgroundOrigin: "padding-box, border-box",
                backgroundImage:
                  "linear-gradient(hsl(var(--surface)), hsl(var(--surface))), linear-gradient(135deg, #7C3AED, #EC4899)",
              }
            : undefined
        }
      >
        {/* Logo + app name */}
        <div className={cn("flex items-center gap-2.5 mb-1 shrink-0", navOpen ? "px-0" : "justify-center")}>
          <img
            src="/conductor-mark-v2.png"
            alt="Conductor"
            className="h-9 w-9 shrink-0 object-contain"
          />
          <span
            className={cn(
              "whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-200 ease-out text-label-large font-bold text-m-on-surface",
              navOpen ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0",
            )}
          >
            Conductor
          </span>
        </div>

        {/* Chevron toggle */}
        <button
          onClick={onToggle}
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors mb-2",
            navOpen && "self-end",
          )}
        >
          {navOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Nav items */}
        {navOpen ? (
          <>
            {entries.map((entry) =>
              entry.kind === "item" ? (
                <NavRow key={entry.item.to} item={entry.item} navOpen={true} />
              ) : (
                <SectionGroup key={entry.section.label} section={entry.section} />
              ),
            )}
          </>
        ) : (
          <>
            {entries.map((entry) =>
              entry.kind === "item" ? (
                <Tooltip key={entry.item.to}>
                  <TooltipTrigger asChild>
                    <NavRow item={entry.item} navOpen={false} />
                  </TooltipTrigger>
                  <TooltipContent side="right">{entry.item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <CollapsedSection key={entry.section.label} section={entry.section} />
              ),
            )}
          </>
        )}

        {/* Report a bug + Profile + Sign out — pinned to bottom. The avatar is
            the profile link: it's where people already look for their own
            account. Reporting sits with them because it is about you and this
            session, not about a section of the product. */}
        <div className="mt-auto space-y-1">
          {navOpen ? (
            <button
              onClick={() => setReporting(true)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-label-medium tracking-normal text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            >
              <Bug className="h-[18px] w-[18px] shrink-0" />
              <span className="whitespace-nowrap overflow-hidden">Report a bug</span>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Report a bug"
                  onClick={() => setReporting(true)}
                  className="grid h-10 w-10 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors"
                >
                  <Bug className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Report a bug</TooltipContent>
            </Tooltip>
          )}
          {navOpen ? (
            <NavLink
              to="/profile"
              aria-label={`Profile — ${displayName}`}
              title={displayName}
              className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-m-surface-container transition-colors"
            >
              <div
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full text-label-medium font-medium",
                  myColor ? "text-white" : "bg-m-primary-container text-m-on-primary-container",
                )}
                style={myColor ? { background: myColor } : undefined}
              >
                {initials}
              </div>
              <span className="truncate text-label-medium tracking-normal text-m-on-surface">{displayName}</span>
            </NavLink>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/profile"
                  aria-label={`Profile — ${displayName}`}
                  className={cn(
                    "mx-auto grid h-9 w-9 place-items-center rounded-full text-label-medium font-medium",
                    myColor ? "text-white" : "bg-m-primary-container text-m-on-primary-container",
                  )}
                  style={myColor ? { background: myColor } : undefined}
                >
                  {initials}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{displayName}</TooltipContent>
            </Tooltip>
          )}
          {navOpen ? (
            <button
              aria-label="Sign out"
              onClick={async () => {
                await signOut()
                navigate("/login", { replace: true })
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-label-medium tracking-normal text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-200 ease-out",
                  navOpen ? "opacity-100 max-w-[200px]" : "opacity-0 max-w-0",
                )}
              >
                Sign out
              </span>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Sign out"
                  onClick={async () => {
                    await signOut()
                    navigate("/login", { replace: true })
                  }}
                  className="grid h-10 w-10 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
      </aside>
      <FeedbackDialog open={reporting} onOpenChange={setReporting} />
    </TooltipProvider>
  )
}
