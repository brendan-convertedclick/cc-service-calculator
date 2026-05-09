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
