import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BookOpen, Building2, Calculator, FolderKanban, Inbox as InboxIcon, LayoutDashboard, LogOut, PackageSearch, Settings as SettingsIcon, SlidersHorizontal, Users, Workflow } from "lucide-react";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useClientProjects } from "@/hooks/useClientProjects";
import { ClientNavSection } from "@/components/nav/ClientNavSection";
import { InboxNavSection } from "@/components/nav/InboxNavSection";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

const nav = [
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
];

export function AppShell() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const { data: clientsWithProjects = [] } = useClientProjects();
  const [inboxBrief, setInboxBrief] = useState<Brief | null>(null);

  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr] bg-m-surface-container-low">
      <aside className="flex flex-col border-r border-m-outline-variant bg-m-surface">
        <div className="flex h-16 items-center gap-2.5 px-6">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container">
            <Calculator className="h-[18px] w-[18px]" />
          </div>
          <div className="leading-tight">
            <div className="text-title-small text-m-on-surface">CC Calculator</div>
            <div className="text-label-small text-m-on-surface-variant">Service pricing</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pt-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-full px-4 py-2.5 text-label-large transition-colors",
                  isActive
                    ? "bg-m-primary-container text-m-on-primary-container"
                    : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
                )
              }
            >
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
            </NavLink>
          ))}

          {/* Divider */}
          <div className="my-2 border-t border-m-outline-variant" />

          {/* Inbox — unlinked briefs */}
          <InboxNavSection onSelectBrief={(b) => setInboxBrief(b)} />

          {/* Client → Project nav — only clients with at least one in_progress project */}
          {clientsWithProjects
            .filter((client) =>
              client.projects.some((p) => p.status === "in_progress")
            )
            .map((client) => (
              <ClientNavSection key={client.id} client={client} />
            ))}
        </nav>
        <div className="border-t border-m-outline-variant px-4 py-3">
          <div className="text-label-small text-m-on-surface-variant">Signed in as</div>
          <div className="truncate text-body-small text-m-on-surface">{user?.email}</div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 items-center justify-end gap-3 border-b border-m-outline-variant bg-m-surface px-8">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {inboxBrief && (
        <InboxAssignModal
          brief={inboxBrief}
          open={!!inboxBrief}
          onClose={() => setInboxBrief(null)}
        />
      )}
    </div>
  );
}
