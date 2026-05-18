import { Navigate, Outlet } from "react-router-dom";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import type { TeamMemberRole } from "@/types/staff-briefs";

type Props = {
  allow: TeamMemberRole[];
  /** Where to redirect when access denied. Defaults to '/'. */
  redirectTo?: string;
};

/**
 * Role gate. Wraps a route subtree and only renders <Outlet/> if the current
 * user's role is in `allow`. While loading, renders a skeleton. On denial,
 * redirects.
 */
export function RequireRole({ allow, redirectTo = "/" }: Props) {
  const { role, isLoading } = useCurrentRole();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-body-medium text-m-on-surface-variant">
        Loading…
      </div>
    );
  }
  if (!role || !allow.includes(role)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}
