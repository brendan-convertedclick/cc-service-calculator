import {
  BadgeCheck,
  Stamp,
  BookOpen,
  Bug,
  Building2,
  CalendarRange,
  ClipboardList,
  Clock3,
  FileBarChart2,
  FileText,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LayoutTemplate,
  Inbox as InboxIcon,
  Mail as MailIcon,
  ListTodo,
  Network,
  PackageSearch,
  Receipt,
  ReceiptText,
  Repeat,
  Rocket,
  ScrollText,
  Settings as SettingsIcon,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  UserCircle2,
  Users,
  Waypoints,
  Wrench,
  Workflow,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { TeamMemberRole } from "@/types/staff-briefs"

// Nav colour is intentionally not encoded per-item. In this product surface the
// accent (the brand gradient) is reserved for the *current selection* only —
// wayfinding, not decoration. Inactive items render in neutral tokens so the
// rail stays calm and the active pill actually reads as "you are here".
/** Everything in the nav is admin/owner unless it says otherwise — that is
 *  what App.tsx's <RequireAdmin> gate enforces for the routes themselves. */
export const ADMIN_ROLES: TeamMemberRole[] = ["admin", "owner"]
/** The surfaces every signed-in person can open: their own portal, the systems
 *  library (authenticated read at the RLS layer) and their profile. */
export const ALL_ROLES: TeamMemberRole[] = ["staff", "admin", "owner"]

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end: boolean
  /** Roles this entry is shown to. Omitted = admin/owner, matching the route
   *  gate — a link that bounces you straight back out is worse than no link. */
  roles?: TeamMemberRole[]
}

export interface NavSection {
  label: string
  icon: LucideIcon
  items: NavItem[]
}

const dashboard: NavItem    = { to: "/",              label: "Dashboard",     icon: LayoutDashboard,   end: true  }
const inbox: NavItem        = { to: "/inbox",         label: "Inbox",         icon: InboxIcon,         end: false }
// Default (admin/owner) visibility on purpose: send-outbound-email refuses
// anyone else, so showing staff a compose screen they cannot send from would
// be a dead end.
const compose: NavItem      = { to: "/comms/new",     label: "Compose",       icon: MailIcon,          end: false }
const pulse: NavItem        = { to: "/pulse",         label: "Pulse",         icon: Zap,               end: false }
const productivity: NavItem = { to: "/productivity",  label: "Productivity",  icon: TrendingUp,        end: false }
const myWork: NavItem       = { to: "/staff",         label: "My work",       icon: ClipboardList,     end: false, roles: ALL_ROLES }
const profile: NavItem      = { to: "/profile",       label: "Profile",       icon: UserCircle2,       end: false, roles: ALL_ROLES }

const pipeline: NavItem       = { to: "/pipeline",      label: "Pipeline",      icon: GitBranch,         end: false }
const services: NavItem       = { to: "/services",      label: "Services",      icon: PackageSearch,     end: false }
const systems: NavItem        = { to: "/systems",       label: "Systems",       icon: Waypoints,         end: false, roles: ALL_ROLES }
const briefs: NavItem         = { to: "/briefs",        label: "Briefs",        icon: FileText,          end: false }
const projects: NavItem       = { to: "/projects",      label: "Projects",      icon: FolderKanban,      end: false }
const clientTime: NavItem   = { to: "/time",          label: "Time per client",icon: Clock3,            end: false }
const retainers: NavItem      = { to: "/retainers",     label: "Retainers",     icon: Repeat,            end: false }
const sow: NavItem            = { to: "/sow",           label: "Scope Composer",icon: ScrollText,        end: false }
const liveTasks: NavItem      = { to: "/scaffold/live-tasks", label: "Live tasks", icon: ListTodo,       end: false }
const foundations: NavItem    = { to: "/scaffold/foundations", label: "Foundations", icon: LayoutTemplate, end: false }
const invoicePreview: NavItem = { to: "/scaffold/invoice-preview", label: "Invoice preview", icon: Receipt, end: false }

const approvals: NavItem      = { to: "/approvals",     label: "Approvals",     icon: BadgeCheck,        end: false }
const clientSignoffs: NavItem = { to: "/client-signoffs", label: "Client sign-offs", icon: Stamp,        end: false }
const escalations: NavItem    = { to: "/escalations",   label: "Escalations",   icon: ShieldAlert,       end: false, roles: ["owner"] }

const clients: NavItem        = { to: "/clients",       label: "Clients",       icon: Building2,         end: false }
const departments: NavItem    = { to: "/departments",   label: "Departments",   icon: Workflow,          end: false }
const team: NavItem           = { to: "/team",          label: "Team",          icon: Users,             end: false }

const reconciliation: NavItem = { to: "/reconciliation",label: "Reconciliation",icon: FileBarChart2,     end: false }
const rules: NavItem          = { to: "/rules",         label: "Rules",         icon: SlidersHorizontal, end: false }
const guides: NavItem         = { to: "/guides",        label: "Guides",        icon: BookOpen,          end: false }
const feedback: NavItem       = { to: "/feedback",      label: "Feedback",      icon: Bug,               end: false }

const reports: NavItem        = { to: "/reports",       label: "Reports",       icon: ReceiptText,       end: false }
const settings: NavItem       = { to: "/settings",      label: "Settings",      icon: SettingsIcon,      end: false }

const deliverySection: NavSection = {
  label: "Delivery",
  icon: Rocket,
  items: [services, systems, briefs, projects, sow, retainers, clientTime, approvals, clientSignoffs, pipeline, escalations],
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
  items: [reconciliation, rules, guides, feedback],
}

// A single ordered nav list so standalone items and section groups can be
// interleaved freely — Pulse sits below the Scaffold section, not up with the
// other top-level shortcuts.
export type NavEntry =
  | { kind: "item"; item: NavItem }
  | { kind: "section"; section: NavSection }

export const navEntries: NavEntry[] = [
  { kind: "item", item: dashboard },
  { kind: "item", item: myWork },
  { kind: "item", item: inbox },
  { kind: "item", item: compose },
  { kind: "item", item: productivity },
  { kind: "section", section: deliverySection },
  { kind: "section", section: scaffoldSection },
  { kind: "item", item: pulse },
  { kind: "section", section: organizationSection },
  { kind: "section", section: operationsSection },
  { kind: "item", item: reports },
  { kind: "item", item: profile },
  { kind: "item", item: settings },
]

function visibleTo(item: NavItem, role: TeamMemberRole): boolean {
  return (item.roles ?? ADMIN_ROLES).includes(role)
}

/**
 * The nav one role actually sees. Entries a role can't open are dropped rather
 * than rendered dead — the route gate already redirects, so showing the link
 * would only teach people to click something that throws them out.
 *
 * A signed-in user with no team_members row is treated as staff: that is
 * exactly what App.tsx's <RequireAdmin> does with them (bounce to /staff).
 */
export function navEntriesFor(role: string | null | undefined): NavEntry[] {
  const effective: TeamMemberRole =
    role === "owner" || role === "admin" ? role : "staff"

  return navEntries.flatMap<NavEntry>((entry) => {
    if (entry.kind === "item") {
      return visibleTo(entry.item, effective) ? [entry] : []
    }
    const items = entry.section.items.filter((i) => visibleTo(i, effective))
    if (items.length === 0) return []
    // A section that filters down to a single child is shown as that child —
    // making someone expand "Delivery" to reach the one page they can open is
    // a click that teaches nothing.
    if (items.length === 1) return [{ kind: "item" as const, item: items[0] }]
    return [{ kind: "section" as const, section: { ...entry.section, items } }]
  })
}

export const ICON_RAIL_WIDTH = 56
