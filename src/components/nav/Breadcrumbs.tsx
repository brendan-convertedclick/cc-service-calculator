import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const SEGMENT_LABELS: Record<string, string> = {
  inbox: "Inbox",
  briefs: "Briefs",
  scope: "Scope",
  builder: "Build quote",
  quotes: "Quotes",
  send: "Send",
  clients: "Clients",
  projects: "Projects",
  settings: "Settings",
  gmail: "Connect Gmail",
  sow: "SOW",
  services: "Services",
  new: "New",
  rules: "Rules",
  departments: "Departments",
  team: "Team",
  pulse: "Pulse",
  reconciliation: "Reconciliation",
  productivity: "Productivity",
  guides: "Guides",
};

// For dynamic id segments, label by the preceding noun.
const ID_LABELS: Record<string, string> = {
  briefs: "Brief",
  quotes: "Quote",
  projects: "Project",
  clients: "Client",
  services: "Service",
  inbox: "Brief",
  sow: "Family",
};

function labelFor(segment: string, prev: string | undefined): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Treat as dynamic id — look up by parent segment
  if (prev && ID_LABELS[prev]) return ID_LABELS[prev];
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  // Root path is the Dashboard — surface it as the current-page crumb so the
  // dashboard carries the same breadcrumb bar as every other page.
  const crumbs =
    segments.length === 0
      ? [{ to: "/", label: "Dashboard", isLast: true }]
      : segments.map((seg, i) => {
          const to = "/" + segments.slice(0, i + 1).join("/");
          const label = labelFor(seg, segments[i - 1]);
          return { to, label, isLast: i === segments.length - 1 };
        });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 px-6 py-2 text-label-small text-m-on-surface-variant border-b border-m-outline-variant bg-m-surface"
    >
      <Link
        to="/"
        className="flex items-center gap-1 hover:text-m-on-surface transition-colors"
        aria-label="Dashboard"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((c) => (
        <Fragment key={c.to}>
          <ChevronRight className="h-3.5 w-3.5 text-m-outline" aria-hidden />
          {c.isLast ? (
            <span className="text-m-on-surface font-medium" aria-current="page">
              {c.label}
            </span>
          ) : (
            <Link to={c.to} className="hover:text-m-on-surface transition-colors">
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
