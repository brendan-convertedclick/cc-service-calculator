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
