import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { useNavOpen } from "@/hooks/useNavOpen";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { navEntriesFor } from "@/components/nav/navItems";
import { QuickBriefSheet, type QuickBriefSheetBrief } from "@/components/QuickBriefSheet";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

// No brief yet: the sheet asks for the client first. Module-level so the
// sheet's prefill effect sees the same object every render.
const NEW_BRIEF: QuickBriefSheetBrief = {
  id: null,
  client_id: null,
  intent_type: null,
  raw_subject: null,
  quick_task_suggestion: null,
};

export function AppShell() {
  const [navOpen, toggleNav] = useNavOpen();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { role } = useCurrentRole();
  const [briefOpen, setBriefOpen] = useState(false);
  // Admin/owner only: the sheet creates a ClickUp task outright, and staff
  // briefs go through approval from /staff instead.
  const canBrief = role === "admin" || role === "owner";

  // On desktop the rail expands inline (pushing content); on mobile the 56px
  // rail stays put and the toggle opens the NavOverlay drawer instead — a
  // 220px inline rail would eat most of a phone screen.
  useEffect(() => {
    if (isDesktop) setOverlayOpen(false);
  }, [isDesktop]);

  return (
    <div className="h-screen flex bg-m-surface-container-low">
      <IconRail
        navOpen={isDesktop && navOpen}
        onToggle={isDesktop ? toggleNav : () => setOverlayOpen(true)}
      />
      {!isDesktop && (
        <NavOverlay
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          entries={navEntriesFor(role)}
        />
      )}
      {/* h-screen root + min-h-0 give main a definite height, so pages can pin
          headers and scroll internally; pages without their own scroll area
          still scroll here via overflow-auto. */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col">
        {/* The top bar sits outside the scroll area so the + is always on
            screen, whatever the page has scrolled to. */}
        <div className="flex items-center border-b border-m-outline-variant bg-m-surface">
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          {canBrief && (
            <div className="px-4">
              <Button
                size="icon"
                className="h-7 w-7"
                aria-label="New brief"
                title="New brief"
                onClick={() => setBriefOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <Outlet />
        </div>
      </main>
      {canBrief && <QuickBriefSheet open={briefOpen} onOpenChange={setBriefOpen} brief={NEW_BRIEF} />}
    </div>
  );
}
