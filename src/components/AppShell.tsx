import { Outlet } from "react-router-dom";
import { IconRail } from "@/components/nav/IconRail";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { useNavOpen } from "@/hooks/useNavOpen";

export function AppShell() {
  const [navOpen, toggleNav] = useNavOpen();

  return (
    <div className="min-h-screen flex bg-m-surface-container-low">
      <IconRail navOpen={navOpen} onToggle={toggleNav} />
      <main className="flex-1 min-h-screen flex flex-col overflow-auto">
        <Breadcrumbs />
        <Outlet />
      </main>
    </div>
  );
}
