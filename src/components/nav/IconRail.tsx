import { Calculator, ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { navItems, type NavItem } from "./navItems"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function NavRow({ item, navOpen }: { item: NavItem; navOpen: boolean }) {
  const { pathname } = useLocation()
  const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to)

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={item.label}
      className={cn(
        "flex items-center shrink-0 transition-all duration-200 ease-out",
        navOpen
          ? cn(
              "w-full gap-3 rounded-full px-3 py-2 text-label-large",
              isActive ? "text-white" : "hover:bg-m-surface-container",
            )
          : cn(
              "h-9 w-9 justify-center rounded-md",
              isActive ? "text-white shadow-sm" : "hover:bg-m-surface-container",
            ),
      )}
      style={isActive ? { background: item.gradient } : { color: item.color }}
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
}

interface IconRailProps {
  navOpen: boolean
  onToggle: () => void
}

export function IconRail({ navOpen, onToggle }: IconRailProps) {
  const { signOut } = useAuth()
  const navigate = useNavigate()

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
                  "linear-gradient(white, white), linear-gradient(135deg, #7C3AED, #EC4899)",
              }
            : undefined
        }
      >
        {/* Logo + app name */}
        <div className={cn("flex items-center gap-2.5 mb-1 shrink-0", navOpen ? "px-0" : "justify-center")}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-brand text-white">
            <Calculator className="h-[18px] w-[18px]" />
          </div>
          <span
            className={cn(
              "whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-200 ease-out text-label-large font-bold bg-gradient-brand bg-clip-text text-transparent",
              navOpen ? "opacity-100 max-w-[160px]" : "opacity-0 max-w-0",
            )}
          >
            Converted Click
          </span>
        </div>

        {/* Chevron toggle */}
        <button
          onClick={onToggle}
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          className={cn(
            "grid h-8 shrink-0 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors mb-2",
            navOpen ? "w-8 self-end" : "w-9",
          )}
        >
          {navOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Nav items */}
        {navItems.map((item) =>
          navOpen ? (
            <NavRow key={item.to} item={item} navOpen={navOpen} />
          ) : (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavRow item={item} navOpen={navOpen} />
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ),
        )}

        {/* Sign out — pinned to bottom */}
        <div className="mt-auto">
          {navOpen ? (
            <button
              aria-label="Sign out"
              onClick={async () => {
                await signOut()
                navigate("/login", { replace: true })
              }}
              className="flex w-full items-center gap-3 rounded-full px-3 py-2 text-label-large text-m-on-surface-variant hover:bg-m-surface-container transition-colors"
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
                  className="grid h-9 w-9 place-items-center rounded-md text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface transition-colors"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
