// src/components/AppShell.tsx
import { useState } from "react"
import { Outlet } from "react-router-dom"
import { InboxAssignModal } from "@/components/scope/InboxAssignModal"
import { useClientProjects } from "@/hooks/useClientProjects"
import { ClientNavSection } from "@/components/nav/ClientNavSection"
import { InboxNavSection } from "@/components/nav/InboxNavSection"
import { IconRail } from "@/components/nav/IconRail"
import { NavOverlay } from "@/components/nav/NavOverlay"
import type { Database } from "@/types/db"

type Brief = Database["public"]["Tables"]["briefs"]["Row"]

export function AppShell() {
  const { data: clientsWithProjects = [] } = useClientProjects()
  const [inboxBrief, setInboxBrief] = useState<Brief | null>(null)
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-screen grid grid-cols-[56px_200px_1fr] bg-m-surface-container-low">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: client/project sidebar */}
      <aside className="flex flex-col border-r border-m-outline-variant bg-m-surface overflow-y-auto">
        <div className="px-3 pt-4 pb-2">
          <p className="px-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
            Clients &amp; Projects
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 pb-3">
          <InboxNavSection onSelectBrief={(b) => setInboxBrief(b)} />

          {clientsWithProjects
            .filter((client) =>
              client.projects.some((p) => p.status === "in_progress")
            )
            .map((client) => (
              <ClientNavSection key={client.id} client={client} />
            ))}
        </nav>
      </aside>

      {/* Column 3: main content */}
      <main className="flex min-h-screen flex-col overflow-auto">
        <Outlet />
      </main>

      {/* Nav overlay + scrim (rendered over columns 2 and 3) */}
      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />

      {inboxBrief && (
        <InboxAssignModal
          brief={inboxBrief}
          open={!!inboxBrief}
          onClose={() => setInboxBrief(null)}
        />
      )}
    </div>
  )
}
