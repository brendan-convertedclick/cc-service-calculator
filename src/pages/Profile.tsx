import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useDepartments } from "@/hooks/useDepartments";
import { memberColors, useTeam, useUpdateTeamMember } from "@/hooks/useTeam";
import { ClickUpConnectCard } from "@/components/ClickUpConnectCard";
import { SkillsEditor } from "@/components/SkillsEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  staff: "Staff",
  admin: "Admin",
  owner: "Owner",
};

/**
 * Everyone's own account page: the fields that are genuinely theirs (name,
 * department, skills), their connected accounts, and sign-out.
 *
 * What is *not* editable here — role, cost rate, email, archived state — is
 * held immutable for non-admins by the team_members BEFORE UPDATE trigger
 * (migration 0115), so this page showing them read-only is the UI agreeing
 * with the database rather than the only thing enforcing it.
 */
export function Profile() {
  const { user, currentUserId, signOut } = useAuth();
  const { role } = useCurrentRole();
  const { data: team = [], isLoading } = useTeam();
  const { data: depts = [] } = useDepartments();
  const update = useUpdateTeamMember();
  const navigate = useNavigate();

  const me = team.find((m) => m.id === currentUserId) ?? null;
  const myColor = useMemo(
    () => (me ? memberColors(team).get(me.id) : undefined),
    [team, me],
  );

  const displayName = me?.full_name ?? user?.email ?? "Signed in";
  const initials = (
    me?.full_name
      ? me.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("")
      : (user?.email?.[0] ?? "?")
  ).toUpperCase();

  const save = (patch: Parameters<typeof update.mutate>[0]["patch"]) => {
    if (!me) return;
    update.mutate(
      { id: me.id, patch },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const signOutAndLeave = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-title-medium font-medium"
          style={
            myColor
              ? { background: myColor, color: "white" }
              : { background: "hsl(var(--mcolor-primary-container))", color: "hsl(var(--mcolor-on-primary-container))" }
          }
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-headline-medium">{displayName}</h1>
          <p className="truncate text-body-small text-m-on-surface-variant">{user?.email}</p>
        </div>
        {role && <Badge variant="secondary">{ROLE_LABEL[role] ?? role}</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            Saved as you leave each field. Email and access level are managed by
            an admin on the Team page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-body-small text-m-on-surface-variant">Loading…</p>
          ) : !me ? (
            // The shared team@ login has no roster row by design (see CLAUDE.md),
            // so there is nothing to edit — say so instead of rendering inputs
            // whose saves would silently go nowhere.
            <p className="text-body-small text-m-on-surface-variant">
              You're signed in as <span className="font-medium">{user?.email}</span>, a shared
              account with no team member record — so there's no personal profile to edit.
              Sign in with your own @convertedclick.co.za account to manage your details.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="profile-name">Full name</Label>
                <Input
                  id="profile-name"
                  defaultValue={me.full_name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== me.full_name) save({ full_name: v });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={me.email ?? ""} readOnly disabled />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-dept">Primary department</Label>
                <select
                  id="profile-dept"
                  defaultValue={me.primary_department_id ?? ""}
                  onChange={(e) => save({ primary_department_id: e.target.value || null })}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm text-m-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <p className="text-label-small text-m-on-surface-variant">
                  Drives which work gets assigned to you by default.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Skills</Label>
                <SkillsEditor skills={me.skills} onChange={(skills) => save({ skills })} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ClickUpConnectCard />

      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription>
            Needed for internal meetings to land on your calendar with a Meet link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/settings/google">
              <CalendarDays className="h-4 w-4" /> Manage Google connection
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={signOutAndLeave}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
