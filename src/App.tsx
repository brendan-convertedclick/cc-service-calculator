// src/App.tsx
import { Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { AuthProvider } from "@/context/AuthContext";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Login } from "@/pages/Login";
import { DashboardPage } from "@/pages/DashboardPage";
import { StaffBriefForm } from "@/pages/StaffBriefForm";

const ServicesList = lazy(() =>
  import("@/pages/ServicesList").then((m) => ({ default: m.ServicesList })),
);
const ServiceDetail = lazy(() =>
  import("@/pages/ServiceDetail").then((m) => ({ default: m.ServiceDetail })),
);
const Rules = lazy(() =>
  import("@/pages/Rules").then((m) => ({ default: m.Rules })),
);
const Departments = lazy(() =>
  import("@/pages/Departments").then((m) => ({ default: m.Departments })),
);
const Team = lazy(() =>
  import("@/pages/Team").then((m) => ({ default: m.Team })),
);
const OngoingTasksPlanner = lazy(() =>
  import("@/pages/OngoingTasksPlanner").then((m) => ({ default: m.OngoingTasksPlanner })),
);
const Foundations = lazy(() =>
  import("@/pages/Foundations").then((m) => ({ default: m.Foundations })),
);
const LiveTasksInvoicePreview = lazy(() =>
  import("@/pages/LiveTasksInvoicePreview").then((m) => ({ default: m.LiveTasksInvoicePreview })),
);
const Inbox = lazy(() =>
  import("@/pages/Inbox").then((m) => ({ default: m.Inbox })),
);
const NewBrief = lazy(() =>
  import("@/pages/NewBrief").then((m) => ({ default: m.NewBrief })),
);
const BriefResume = lazy(() =>
  import("@/pages/BriefResume").then((m) => ({ default: m.BriefResume })),
);
const Scope = lazy(() =>
  import("@/pages/Scope").then((m) => ({ default: m.Scope })),
);
const ProjectBuilder = lazy(() =>
  import("@/pages/ProjectBuilder").then((m) => ({ default: m.ProjectBuilder })),
);
const QuoteSend = lazy(() =>
  import("@/pages/QuoteSend").then((m) => ({ default: m.QuoteSend })),
);
const QuoteDetail = lazy(() =>
  import("@/pages/QuoteDetail").then((m) => ({ default: m.QuoteDetail })),
);
const Projects = lazy(() =>
  import("@/pages/Projects").then((m) => ({ default: m.Projects })),
);
const ProjectDetail = lazy(() =>
  import("@/pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail })),
);
const Clients = lazy(() =>
  import("@/pages/Clients").then((m) => ({ default: m.Clients })),
);
const ClientDetail = lazy(() =>
  import("@/pages/ClientDetail").then((m) => ({ default: m.ClientDetail })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const SettingsConnectGmail = lazy(() =>
  import("@/pages/SettingsConnectGmail").then((m) => ({ default: m.SettingsConnectGmail })),
);
const Guides = lazy(() =>
  import("@/pages/Guides").then((m) => ({ default: m.Guides })),
);
const ProjectScopeView = lazy(() =>
  import("@/pages/ProjectScopeView").then((m) => ({ default: m.ProjectScopeView })),
);
const ReconciliationView = lazy(() =>
  import("@/pages/ReconciliationView").then((m) => ({ default: m.ReconciliationView })),
);
const PulseView = lazy(() =>
  import("@/pages/PulseView").then((m) => ({ default: m.PulseView })),
);
const SOWFamilyPage = lazy(() => import("@/pages/SOWFamilyPage"));
const ProductivityPage = lazy(() =>
  import("@/pages/ProductivityPage").then((m) => ({ default: m.ProductivityPage })),
);
const Approvals = lazy(() =>
  import("@/pages/Approvals").then((m) => ({ default: m.Approvals })),
);
const Escalations = lazy(() =>
  import("@/pages/Escalations").then((m) => ({ default: m.Escalations })),
);

/**
 * Phase 1 role gates.
 * - <RoleAwareIndex> at `/` redirects staff to `/staff`, others see Dashboard.
 * - <RequireAdmin> blocks staff from the full app and bounces them to `/staff`.
 */
function RoleAwareIndex() {
  const { role, isLoading } = useCurrentRole();
  if (isLoading) return <RouteFallback />;
  if (role === "staff") return <Navigate to="/staff" replace />;
  return <DashboardPage />;
}
function RequireAdmin() {
  const { role, isLoading } = useCurrentRole();
  if (isLoading) return <RouteFallback />;
  if (role !== "admin" && role !== "owner") return <Navigate to="/staff" replace />;
  return <Outlet />;
}
function RequireOwner() {
  const { role, isLoading } = useCurrentRole();
  if (isLoading) return <RouteFallback />;
  if (role !== "owner") return <Navigate to="/" replace />;
  return <Outlet />;
}

function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-body-medium text-m-on-surface-variant">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            {/* Phase 1: staff-only single-page surface */}
            <Route path="/staff" element={<StaffBriefForm />} />

            {/* Index decides based on role: staff → /staff, admin/owner → Dashboard */}
            <Route index element={<RoleAwareIndex />} />

            {/* Everything below requires admin or owner. Staff bounce to /staff. */}
            <Route element={<RequireAdmin />}>
              <Route path="approvals" element={<Approvals />} />
              {/* Owner-only escalations queue (>50% extension requests) */}
              <Route element={<RequireOwner />}>
                <Route path="escalations" element={<Escalations />} />
              </Route>
              {/* All other routes — AppShell without sidebar */}
              <Route element={<AppShell />}>
                <Route path="inbox" element={<Inbox />} />
              <Route path="inbox/:briefId" element={<Inbox />} />
              <Route path="briefs" element={<Navigate to="/inbox" replace />} />
              <Route path="briefs/new" element={<NewBrief />} />
              <Route path="briefs/:id" element={<BriefResume />} />
              <Route path="briefs/:id/scope" element={<Scope />} />
              <Route path="briefs/:id/builder" element={<ProjectBuilder />} />
              <Route path="quotes" element={<Navigate to="/inbox" replace />} />
              <Route path="quotes/:id" element={<QuoteDetail />} />
              <Route path="quotes/:id/send" element={<QuoteSend />} />
              <Route path="clients" element={<Clients />} />
              <Route path="clients/:id" element={<ClientDetail />} />
              <Route path="clients/:clientId/projects" element={<Navigate to="/clients" replace />} />
              <Route path="clients/:clientId/projects/:projectId" element={<ProjectScopeView />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/gmail" element={<SettingsConnectGmail />} />
              <Route path="sow" element={<Navigate to="/services" replace />} />
              <Route path="sow/:familySlug" element={<SOWFamilyPage />} />
              <Route path="services" element={<ServicesList />} />
              <Route path="services/new" element={<ServiceDetail mode="new" />} />
              <Route path="services/:id" element={<ServiceDetail mode="edit" />} />
              <Route path="rules" element={<Rules />} />
              <Route path="departments" element={<Departments />} />
              <Route path="team" element={<Team />} />
              <Route path="scaffold" element={<Navigate to="/scaffold/live-tasks" replace />} />
              <Route path="scaffold/live-tasks" element={<OngoingTasksPlanner />} />
              <Route path="scaffold/foundations" element={<Foundations />} />
              <Route path="scaffold/invoice-preview" element={<LiveTasksInvoicePreview />} />
              <Route path="pulse" element={<PulseView />} />
              <Route path="reconciliation" element={<ReconciliationView />} />
              <Route path="productivity" element={<ProductivityPage />} />
              <Route path="guides" element={<Guides />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
