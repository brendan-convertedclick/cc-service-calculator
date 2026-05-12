import { useEffect } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { navItems, ICON_RAIL_WIDTH, type NavItem } from "./navItems"

function NavRow({ item, onClose }: { item: NavItem; onClose: () => void }) {
  const { pathname } = useLocation()
  const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to)
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 rounded-full px-4 py-2.5 text-label-large transition-all",
        isActive ? "text-white shadow-sm" : "hover:bg-m-surface-container",
      )}
      style={
        isActive
          ? { background: item.gradient }
          : { color: item.color }
      }
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      {item.label}
    </NavLink>
  )
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
          "fixed top-0 bottom-0 z-50 w-[220px] bg-m-surface border-r-2 border-transparent shadow-elev-3",
          "flex flex-col gap-0.5 px-3 pt-4 pb-3",
          "transition-[transform,opacity] duration-200 ease-out",
          open
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none"
        )}
        style={{
          left: ICON_RAIL_WIDTH,
          visibility: open ? "visible" : "hidden",
          borderRight: "2px solid transparent",
          backgroundClip: "padding-box, border-box",
          backgroundOrigin: "padding-box, border-box",
          backgroundImage: "linear-gradient(white, white), linear-gradient(135deg, #7C3AED, #EC4899)",
        }}
      >
        <p className="px-3 pb-2 text-label-small uppercase tracking-wide text-m-on-surface-variant">
          Navigation
        </p>

        {navItems.map((item) => (
          <NavRow key={item.to} item={item} onClose={onClose} />
        ))}
      </nav>
    </>
  )
}
