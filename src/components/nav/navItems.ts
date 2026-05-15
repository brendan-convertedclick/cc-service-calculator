import {
  BookOpen,
  Building2,
  CalendarRange,
  FileBarChart2,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  Inbox as InboxIcon,
  ListTodo,
  Network,
  PackageSearch,
  Rocket,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wrench,
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

export interface NavSection {
  label: string
  icon: LucideIcon
  gradient: string
  color: string
  items: NavItem[]
}

const dashboard: NavItem    = { to: "/",              label: "Dashboard",     icon: LayoutDashboard,   end: true,  gradient: "linear-gradient(135deg, #7C3AED, #EC4899)", color: "#7C3AED" }
const inbox: NavItem        = { to: "/inbox",         label: "Inbox",         icon: InboxIcon,         end: false, gradient: "linear-gradient(135deg, #2563EB, #0891B2)", color: "#2563EB" }
const pulse: NavItem        = { to: "/pulse",         label: "Pulse",         icon: Zap,               end: false, gradient: "linear-gradient(135deg, #D97706, #EA580C)", color: "#D97706" }
const productivity: NavItem = { to: "/productivity",  label: "Productivity",  icon: TrendingUp,        end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" }

const services: NavItem       = { to: "/services",      label: "Services",      icon: PackageSearch,     end: false, gradient: "linear-gradient(135deg, #EA580C, #FBBF24)", color: "#EA580C" }
const projects: NavItem       = { to: "/projects",      label: "Projects",      icon: FolderKanban,      end: false, gradient: "linear-gradient(135deg, #4F46E5, #7C3AED)", color: "#4F46E5" }
const liveTasks: NavItem      = { to: "/scaffold/live-tasks", label: "Live tasks", icon: ListTodo,       end: false, gradient: "linear-gradient(135deg, #F97316, #FBBF24)", color: "#F97316" }
const foundations: NavItem    = { to: "/scaffold/foundations", label: "Foundations", icon: LayoutTemplate, end: false, gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#6366F1" }

const clients: NavItem        = { to: "/clients",       label: "Clients",       icon: Building2,         end: false, gradient: "linear-gradient(135deg, #0891B2, #059669)", color: "#0891B2" }
const departments: NavItem    = { to: "/departments",   label: "Departments",   icon: Workflow,          end: false, gradient: "linear-gradient(135deg, #059669, #0891B2)", color: "#059669" }
const team: NavItem           = { to: "/team",          label: "Team",          icon: Users,             end: false, gradient: "linear-gradient(135deg, #0284C7, #4F46E5)", color: "#0284C7" }

const reconciliation: NavItem = { to: "/reconciliation",label: "Reconciliation",icon: FileBarChart2,     end: false, gradient: "linear-gradient(135deg, #E11D48, #EC4899)", color: "#E11D48" }
const rules: NavItem          = { to: "/rules",         label: "Rules",         icon: SlidersHorizontal, end: false, gradient: "linear-gradient(135deg, #9333EA, #6366F1)", color: "#9333EA" }
const guides: NavItem         = { to: "/guides",        label: "Guides",        icon: BookOpen,          end: false, gradient: "linear-gradient(135deg, #B45309, #D97706)", color: "#B45309" }

const settings: NavItem       = { to: "/settings",      label: "Settings",      icon: SettingsIcon,      end: false, gradient: "linear-gradient(135deg, #475569, #4F46E5)", color: "#475569" }

export const topNavItems: NavItem[] = [dashboard, inbox, pulse, productivity]

export const navSections: NavSection[] = [
  {
    label: "Delivery",
    icon: Rocket,
    gradient: "linear-gradient(135deg, #DB2777, #F97316)",
    color: "#DB2777",
    items: [services, projects],
  },
  {
    label: "Scaffold",
    icon: CalendarRange,
    gradient: "linear-gradient(135deg, #F97316, #FBBF24)",
    color: "#F97316",
    items: [liveTasks, foundations],
  },
  {
    label: "Organization",
    icon: Network,
    gradient: "linear-gradient(135deg, #0EA5E9, #6366F1)",
    color: "#0EA5E9",
    items: [clients, departments, team],
  },
  {
    label: "Operations",
    icon: Wrench,
    gradient: "linear-gradient(135deg, #64748B, #475569)",
    color: "#64748B",
    items: [reconciliation, rules, guides],
  },
]

export const bottomNavItems: NavItem[] = [settings]

// Flat list — preserved for the collapsed icon rail and any consumers that
// want every nav target in display order.
export const navItems: NavItem[] = [
  ...topNavItems,
  ...navSections.flatMap((s) => s.items),
  ...bottomNavItems,
]

export const ICON_RAIL_WIDTH = 56
