import { Link, useMatch } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Project = Database["public"]["Tables"]["projects"]["Row"];

const statusDot: Record<string, string> = {
  on_track: "bg-m-tertiary",
  needs_attention: "bg-amber-400",
  overdue: "bg-m-error",
};

interface Props {
  project: Project;
  clientId: string;
}

export function ProjectNavRow({ project, clientId }: Props) {
  const to = `/clients/${clientId}/projects/${project.id}`;
  const match = useMatch({ path: to, end: false });

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-label-medium transition-colors",
        match
          ? "bg-m-primary-container text-m-on-primary-container"
          : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      )}
    >
      <span
        data-testid="status-dot"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          statusDot[project.scope_status ?? "on_track"]
        )}
      />
      <span className="flex-1 truncate">{project.name}</span>
      <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] bg-m-surface-container text-m-on-surface-variant">
        {project.engagement_type ?? "fixed"}
      </span>
    </Link>
  );
}
