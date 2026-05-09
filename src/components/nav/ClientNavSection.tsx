import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectNavRow } from "./ProjectNavRow";
import type { ClientWithProjects } from "@/hooks/useClientProjects";

interface Props {
  client: ClientWithProjects;
  defaultOpen?: boolean;
}

export function ClientNavSection({ client, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-label-small uppercase tracking-wide text-m-on-surface-variant hover:text-m-on-surface transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{client.name}</span>
      </button>

      <div data-testid="projects-list" className={cn("flex flex-col gap-0.5 pl-2", !open && "hidden")}>
        {client.projects.filter((p) => p.status === "in_progress").length === 0 && (
          <p className="px-3 py-1 text-label-small text-m-on-surface-variant italic">
            No active projects
          </p>
        )}
        {client.projects
          .filter((p) => p.status === "in_progress")
          .map((p) => (
            <ProjectNavRow key={p.id} project={p} clientId={client.id} />
          ))}
      </div>
    </div>
  );
}
