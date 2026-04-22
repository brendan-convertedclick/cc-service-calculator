import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/hooks/useProjects";
import { useBriefs } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];
type BriefStatus = Database["public"]["Enums"]["brief_status"];

const IN_PROGRESS: BriefStatus[] = ["triaged", "scoped", "quoted", "accepted"];

const STATUS_LABEL: Record<BriefStatus, string> = {
  new: "New",
  needs_info: "Awaiting client",
  triaged: "Scoping",
  scoped: "Building",
  quoted: "Quoted",
  accepted: "Accepted",
  rejected: "Rejected",
  archived: "Archived",
  spam: "Spam",
};

function resumeHref(b: Brief): string {
  switch (b.status) {
    case "triaged":
      return `/briefs/${b.id}/scope`;
    case "scoped":
    case "quoted":
    case "accepted":
      return `/briefs/${b.id}/builder`;
    default:
      return `/briefs/${b.id}/scope`;
  }
}

export function Projects() {
  const { data: projects = [] } = useProjects();
  const { data: inFlight = [] } = useBriefs(IN_PROGRESS);
  const { data: clients = [] } = useClients();
  const clientById = new Map(clients.map((c) => [c.id, c.name]));

  const empty = projects.length === 0 && inFlight.length === 0;

  return (
    <div className="container mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-headline-medium">Projects</h1>

      {empty && (
        <div className="text-body-medium text-m-on-surface-variant">
          No projects or open briefs yet. Accept a brief from the Inbox to start one.
        </div>
      )}

      {inFlight.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-title-medium">In progress ({inFlight.length})</h2>
          <div className="space-y-2">
            {inFlight.map((b) => {
              const clientName = b.client_id ? clientById.get(b.client_id) : undefined;
              return (
                <Link to={resumeHref(b)} key={b.id} className="block">
                  <Card className="transition-colors hover:bg-m-surface-container">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-title-small">
                          {b.raw_subject ?? "(no subject)"}
                        </div>
                        <div className="text-label-small text-m-on-surface-variant">
                          {clientName ?? b.sender_email ?? "manual"} ·{" "}
                          {new Date(b.received_at).toLocaleDateString("en-ZA")}
                        </div>
                      </div>
                      <Badge>{STATUS_LABEL[b.status]}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {projects.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-title-medium">Active ({projects.length})</h2>
          <div className="space-y-2">
            {projects.map((p) => (
              <Link to={`/projects/${p.id}`} key={p.id} className="block">
                <Card className="transition-colors hover:bg-m-surface-container">
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                      {/* Cast until `npm run supabase:gen-types` regenerates src/types/db.ts post-0015. */}
                      <div className="text-title-small">
                        {(p as { name?: string }).name ?? "Untitled project"}
                      </div>
                      <div className="text-label-small text-m-on-surface-variant">
                        Started {new Date(p.started_at).toLocaleDateString("en-ZA")}
                      </div>
                    </div>
                    <Badge>{p.status}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
