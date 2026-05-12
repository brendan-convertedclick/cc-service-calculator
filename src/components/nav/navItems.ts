import {
  BookOpen,
  Building2,
  FileBarChart2,
  FolderKanban,
  LayoutDashboard,
  Inbox as InboxIcon,
  PackageSearch,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  gradient: string  // active background gradient
  color: string     // inactive icon color
}

export const navItems: NavItem[] = [
  { to: "/",              label: "Dashboard",     icon: LayoutDashboard,   end: true,  gradient: "linear-gradient(135deg, #7C3AED, #EC4899)", color: "#7C3AED" },
  { to: "/inbox",         label: "Inbox",         icon: InboxIcon,         end: false, gradient: "linear-gradient(135deg, #2563EB, #0891B2)", color: "#2563EB" },
  { to: "/services",      label: "Services",      icon: PackageSearch,     end: false, gradient: "linear-gradient(135deg, #EA580C, #FBBF24)", color: "#EA580C" },
  { to: "/clients",       label: "Clients",       icon: Building2,         end: false, gradient: "linear-gradient(135deg, #0891B2, #059669)", color: "#0891B2" },
  { to: "/projects",      label: "Projects",      icon: FolderKanban,      end: false, gradient: "linear-gradient(135deg, #4F46E5, #7C3AED)", color: "#4F46E5" },
  { to: "/pulse",         label: "Pulse",         icon: Zap,               end: false, gradient: "linear-gradient(135deg, #D97706, #EA580C)", color: "#D97706" },
  { to: "/productivity",  label: "Productivity",  icon: TrendingUp,        end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" },
  { to: "/reconciliation",label: "Reconciliation",icon: FileBarChart2,     end: false, gradient: "linear-gradient(135deg, #E11D48, #EC4899)", color: "#E11D48" },
  { to: "/rules",         label: "Rules",         icon: SlidersHorizontal, end: false, gradient: "linear-gradient(135deg, #9333EA, #6366F1)", color: "#9333EA" },
  { to: "/departments",   label: "Departments",   icon: Workflow,          end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" },
  { to: "/team",          label: "Team",          icon: Users,             end: false, gradient: "linear-gradient(135deg, #0284C7, #4F46E5)", color: "#0284C7" },
  { to: "/guides",        label: "Guides",        icon: BookOpen,          end: false, gradient: "linear-gradient(135deg, #B45309, #D97706)", color: "#B45309" },
  { to: "/settings",      label: "Settings",      icon: SettingsIcon,      end: false, gradient: "linear-gradient(135deg, #475569, #4F46E5)", color: "#475569" },
]

export const ICON_RAIL_WIDTH = 56
