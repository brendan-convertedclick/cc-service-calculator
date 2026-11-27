import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { isLocalDev } from "@/lib/env";
import { peekOAuthReturn } from "@/lib/oauth-return";

export function RequireAuth() {
  const { session, loading } = useAuth();
  const loc = useLocation();

  if (isLocalDev()) return <Outlet />;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  // Back to a connector consent screen that a Google or Stitch sign-in left.
  const back = peekOAuthReturn();
  if (back) return <Navigate to={back} replace />;
  return <Outlet />;
}
