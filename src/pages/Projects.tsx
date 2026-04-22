import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/hooks/useProjects";

export function Projects() {
  const { data: projects = [] } = useProjects();
  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-4">
      <h1 className="text-headline-medium">Projects</h1>
      {projects.length === 0 && (
        <div className="text-body-medium text-m-on-surface-variant">
          No projects yet. Accept a quote with ClickUp enabled to create one.
        </div>
      )}
      {projects.map((p) => (
        <Link to={`/projects/${p.id}`} key={p.id} className="block">
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-title-small">ClickUp task {p.clickup_parent_task_id}</div>
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
  );
}
