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
  gradient?: string
  color?: string
}

export const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, end: false },
  { to: "/services", label: "Services", icon: PackageSearch, end: false },
  { to: "/clients", label: "Clients", icon: Building2, end: false },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: false },
  { to: "/pulse", label: "Pulse", icon: Zap, end: false },
  { to: "/productivity", label: "Productivity", icon: TrendingUp, end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" },
  { to: "/reconciliation", label: "Reconciliation", icon: FileBarChart2, end: false },
  { to: "/rules", label: "Rules", icon: SlidersHorizontal, end: false },
  { to: "/departments", label: "Departments", icon: Workflow, end: false },
  { to: "/team", label: "Team", icon: Users, end: false },
  { to: "/guides", label: "Guides", icon: BookOpen, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
]

export const ICON_RAIL_WIDTH = 56
