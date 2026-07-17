import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { useNavOpen } from "@/hooks/useNavOpen";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export function AppShell() {
  const [navOpen, toggleNav] = useNavOpen();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [overlayOpen, setOverlayOpen] = useState(false);

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
        <NavOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />
      )}
      {/* h-screen root + min-h-0 give main a definite height, so pages can pin
          headers and scroll internally; pages without their own scroll area
          still scroll here via overflow-auto. */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto">
        <Breadcrumbs />
        <Outlet />
      </main>
    </div>
  );
}
