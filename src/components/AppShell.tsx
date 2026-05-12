import { useState } from "react";
import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-m-surface-container-low">
      <IconRail navOpen={navOpen} onToggle={() => setNavOpen((o) => !o)} />
      <main className="flex-1 min-h-screen flex flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
