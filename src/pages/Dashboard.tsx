import { Link } from "react-router-dom";
import { PackageSearch, SlidersHorizontal, Users, Workflow } from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { useRules } from "@/hooks/useRules";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Dashboard() {
  const { data: services = [] } = useServices();
  const { data: rules = [] } = useRules();
  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();

  const active = services.filter((s) => s.status === "active");

  const stats = [
    { label: "Services", value: services.length, sub: `${active.length} active`, icon: PackageSearch, to: "/services" },
    { label: "Rules", value: rules.length, sub: "allocation templates", icon: SlidersHorizontal, to: "/rules" },
    { label: "Departments", value: depts.length, sub: "teams with rates", icon: Workflow, to: "/departments" },
    { label: "Team", value: team.length, sub: "members", icon: Users, to: "/team" },
  ];

  return (
    <div className="container mx-auto max-w-6xl p-8">
      <h1 className="text-headline-medium text-m-on-surface">Dashboard</h1>
      <p className="mt-1 text-body-medium text-m-on-surface-variant">Overview of the service catalogue.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="group">
            <Card className="h-full transition-all group-hover:shadow-elev-2 group-hover:-translate-y-0.5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-label-large text-m-on-surface-variant">{s.label}</CardTitle>
                <div className="grid h-8 w-8 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container">
                  <s.icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-display-small text-m-on-surface">{s.value}</div>
                <p className="mt-1 text-body-small text-m-on-surface-variant">{s.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
