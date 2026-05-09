import { useEffect } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { navItems, ICON_RAIL_WIDTH } from "./navItems"

declare module "react" {
  interface HTMLAttributes<T> {
    inert?: ""
  }
}

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
        {...(!open ? { inert: "" } : {})}
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={{ left: ICON_RAIL_WIDTH, visibility: open ? "visible" : "hidden" }}
      />

      {/* Overlay panel */}
      <nav
        aria-label="Main navigation"
        {...(!open ? { inert: "" } : {})}
        className={cn(
          "fixed top-0 bottom-0 z-50 w-[220px] bg-m-surface border-r-2 border-m-primary shadow-elev-3",
          "flex flex-col gap-0.5 px-3 pt-4 pb-3",
          "transition-[transform,opacity] duration-200 ease-out",
          open
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none"
        )}
        style={{ left: ICON_RAIL_WIDTH, visibility: open ? "visible" : "hidden" }}
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
