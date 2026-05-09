// src/components/AppShell.tsx
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";
import { NavOverlay } from "@/components/nav/NavOverlay";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen grid grid-cols-[56px_1fr] bg-m-surface-container-low">
      {/* Column 1: icon rail */}
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />

      {/* Column 2: main content */}
      <main className="flex min-h-screen flex-col overflow-auto">
        <Outlet />
      </main>

      <NavOverlay open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
