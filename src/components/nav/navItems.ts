import {
  BookOpen,
  Building2,
  CalendarRange,
  FileBarChart2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  Inbox as InboxIcon,
  ListTodo,
  Network,
  PackageSearch,
  Receipt,
  Repeat,
  Rocket,
  ScrollText,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wrench,
  Workflow,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Nav colour is intentionally not encoded per-item. In this product surface the
// accent (the brand gradient) is reserved for the *current selection* only —
// wayfinding, not decoration. Inactive items render in neutral tokens so the
// rail stays calm and the active pill actually reads as "you are here".
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
}

export interface NavSection {
  label: string
  icon: LucideIcon
  items: NavItem[]
}

const dashboard: NavItem    = { to: "/",              label: "Dashboard",     icon: LayoutDashboard,   end: true  }
const inbox: NavItem        = { to: "/inbox",         label: "Inbox",         icon: InboxIcon,         end: false }
const pulse: NavItem        = { to: "/pulse",         label: "Pulse",         icon: Zap,               end: false }
const productivity: NavItem = { to: "/productivity",  label: "Productivity",  icon: TrendingUp,        end: false }

const services: NavItem       = { to: "/services",      label: "Services",      icon: PackageSearch,     end: false }
const briefs: NavItem         = { to: "/briefs",        label: "Briefs",        icon: FileText,          end: false }
const projects: NavItem       = { to: "/projects",      label: "Projects",      icon: FolderKanban,      end: false }
const retainers: NavItem      = { to: "/retainers",     label: "Retainers",     icon: Repeat,            end: false }
const sow: NavItem            = { to: "/sow",           label: "Scope Composer",icon: ScrollText,        end: false }
const liveTasks: NavItem      = { to: "/scaffold/live-tasks", label: "Live tasks", icon: ListTodo,       end: false }
const foundations: NavItem    = { to: "/scaffold/foundations", label: "Foundations", icon: LayoutTemplate, end: false }
const invoicePreview: NavItem = { to: "/scaffold/invoice-preview", label: "Invoice preview", icon: Receipt, end: false }

const clients: NavItem        = { to: "/clients",       label: "Clients",       icon: Building2,         end: false }
const departments: NavItem    = { to: "/departments",   label: "Departments",   icon: Workflow,          end: false }
const team: NavItem           = { to: "/team",          label: "Team",          icon: Users,             end: false }

const reconciliation: NavItem = { to: "/reconciliation",label: "Reconciliation",icon: FileBarChart2,     end: false }
const rules: NavItem          = { to: "/rules",         label: "Rules",         icon: SlidersHorizontal, end: false }
const guides: NavItem         = { to: "/guides",        label: "Guides",        icon: BookOpen,          end: false }

const settings: NavItem       = { to: "/settings",      label: "Settings",      icon: SettingsIcon,      end: false }

const deliverySection: NavSection = {
  label: "Delivery",
  icon: Rocket,
  items: [services, briefs, projects, sow, retainers],
}
const scaffoldSection: NavSection = {
  label: "Scaffold",
  icon: CalendarRange,
  items: [liveTasks, foundations, invoicePreview],
}
const organizationSection: NavSection = {
  label: "Organization",
  icon: Network,
  items: [clients, departments, team],
}
const operationsSection: NavSection = {
  label: "Operations",
  icon: Wrench,
  items: [reconciliation, rules, guides],
}

// A single ordered nav list so standalone items and section groups can be
// interleaved freely — Pulse sits below the Scaffold section, not up with the
// other top-level shortcuts.
export type NavEntry =
  | { kind: "item"; item: NavItem }
  | { kind: "section"; section: NavSection }

export const navEntries: NavEntry[] = [
  { kind: "item", item: dashboard },
  { kind: "item", item: inbox },
  { kind: "item", item: productivity },
  { kind: "section", section: deliverySection },
  { kind: "section", section: scaffoldSection },
  { kind: "item", item: pulse },
  { kind: "section", section: organizationSection },
  { kind: "section", section: operationsSection },
  { kind: "item", item: settings },
]

export const ICON_RAIL_WIDTH = 56
