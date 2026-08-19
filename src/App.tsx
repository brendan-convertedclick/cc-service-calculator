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
const Briefs = lazy(() =>
  import("@/pages/Briefs").then((m) => ({ default: m.Briefs })),
);
const ProjectDetail = lazy(() =>
  import("@/pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail })),
);
const NewProjectWizard = lazy(() =>
  import("@/pages/NewProjectWizard").then((m) => ({ default: m.NewProjectWizard })),
);
const Feedback = lazy(() =>
  import("@/pages/Feedback").then((m) => ({ default: m.Feedback })),
);
const RetainersList = lazy(() =>
  import("@/pages/RetainersList").then((m) => ({ default: m.RetainersList })),
);
const NewRetainerWizard = lazy(() =>
  import("@/pages/NewRetainerWizard").then((m) => ({ default: m.NewRetainerWizard })),
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
const SettingsEmailTemplates = lazy(() =>
  import("@/pages/SettingsEmailTemplates").then((m) => ({ default: m.SettingsEmailTemplates })),
);
const SettingsConnectGoogle = lazy(() =>
  import("@/pages/SettingsConnectGoogle").then((m) => ({ default: m.SettingsConnectGoogle })),
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
const ProductivityPage = lazy(() =>
  import("@/pages/ProductivityPage").then((m) => ({ default: m.ProductivityPage })),
);
const Approvals = lazy(() =>
  import("@/pages/Approvals").then((m) => ({ default: m.Approvals })),
);
const Escalations = lazy(() =>
  import("@/pages/Escalations").then((m) => ({ default: m.Escalations })),
);
const ComposeEmail = lazy(() =>
  import("@/pages/ComposeEmail").then((m) => ({ default: m.ComposeEmail })),
);
const SowCheck = lazy(() =>
  import("@/pages/SowCheck").then((m) => ({ default: m.SowCheck })),
);
const SowComposer = lazy(() =>
  import("@/pages/SowComposer").then((m) => ({ default: m.SowComposer })),
);
const SowList = lazy(() =>
  import("@/pages/SowList").then((m) => ({ default: m.SowList })),
);
const SowManage = lazy(() =>
  import("@/pages/SowManage").then((m) => ({ default: m.SowManage })),
);
const Reports = lazy(() =>
  import("@/pages/Reports").then((m) => ({ default: m.Reports })),
);
const SystemsList = lazy(() =>
  import("@/pages/SystemsList").then((m) => ({ default: m.SystemsList })),
);
const ProcedureWizard = lazy(() =>
  import("@/pages/ProcedureWizard").then((m) => ({ default: m.ProcedureWizard })),
);
const SystemDetail = lazy(() =>
  import("@/pages/SystemDetail").then((m) => ({ default: m.SystemDetail })),
);
const Profile = lazy(() =>
  import("@/pages/Profile").then((m) => ({ default: m.Profile })),
);

/**
 * Role gates. Everything an admin/owner-only route needs sits behind
 * <RequireAdmin>, which bounces staff (and anyone with no team_members row)
 * to `/staff`. The shared surfaces — /staff, /profile, /systems — sit outside
 * it, and the nav rail filters itself to match (see navEntriesFor).
 */
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
            {/* Full-screen surfaces that deliberately sit outside the shell. */}
            <Route element={<RequireAdmin />}>
              <Route path="approvals" element={<Approvals />} />
              {/* Phase 6: outbound communications compose */}
              <Route path="comms/new" element={<ComposeEmail />} />
            </Route>

            {/* The shell (nav rail + breadcrumbs) wraps everyone, staff
                included — the rail filters itself by role (navEntriesFor), so
                a staff session gets navigation instead of a dead-end page. */}
            <Route element={<AppShell />}>
              {/* Open to every signed-in person: their own portal, the systems
                  library (read and write — see CLAUDE.md) and profile. */}
              <Route path="staff" element={<StaffBriefForm />} />
              <Route path="profile" element={<Profile />} />
              <Route path="systems" element={<SystemsList />} />
              <Route path="systems/:id" element={<SystemDetail />} />
              {/* Top-level, not /systems/wizard: it keeps the Systems nav
                  item's active state honest on the detail route. Open to
                  everyone — it's pure client-side triage, and it's the on-ramp
                  to creating a procedure, which everyone can do. */}
              <Route path="procedure-wizard" element={<ProcedureWizard />} />
              {/* /procedures was the old name for this surface — kept as an
                  alias so bookmarks and pasted links don't 404. */}
              <Route path="procedures" element={<Navigate to="/systems" replace />} />
              <Route path="procedures/:id" element={<SystemDetail />} />
              {/* Per-user Google connection status — staff need it to schedule
                  internal meetings, so it lives outside the admin gate that
                  covers the rest of /settings. */}
              <Route path="settings/google" element={<SettingsConnectGoogle />} />

              {/* Everything below requires admin or owner. Staff bounce to /staff. */}
              <Route element={<RequireAdmin />}>
                {/* Owner-only escalations queue (>50% extension requests).
                    Inside the shell: it's a daily working surface, so it keeps
                    the nav rail and breadcrumbs like every other queue. */}
                <Route path="feedback" element={<Feedback />} />
                <Route element={<RequireOwner />}>
                  <Route path="escalations" element={<Escalations />} />
                </Route>
                {/* Staff never get here — RequireAdmin sends them to /staff. */}
                <Route index element={<DashboardPage />} />
                <Route path="inbox" element={<Inbox />} />
              <Route path="inbox/:briefId" element={<Inbox />} />
              <Route path="briefs" element={<Briefs />} />
              <Route path="briefs/view/:briefId" element={<Briefs />} />
              <Route path="briefs/new" element={<NewBrief />} />
              <Route path="briefs/:id" element={<BriefResume />} />
              <Route path="briefs/:id/scope" element={<Scope />} />
              <Route path="briefs/:id/sow-check" element={<SowCheck />} />
              <Route path="briefs/:id/builder" element={<ProjectBuilder />} />
              <Route path="quotes" element={<Navigate to="/inbox" replace />} />
              <Route path="quotes/:id" element={<QuoteDetail />} />
              <Route path="quotes/:id/send" element={<QuoteSend />} />
              <Route path="clients" element={<Clients />} />
              <Route path="clients/:id" element={<ClientDetail />} />
              <Route path="clients/:clientId/projects" element={<Navigate to="/clients" replace />} />
              <Route path="clients/:clientId/projects/:projectId" element={<ProjectScopeView />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/new" element={<NewProjectWizard />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="retainers" element={<RetainersList />} />
              <Route path="retainers/new" element={<NewRetainerWizard />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/gmail" element={<SettingsConnectGmail />} />
              <Route path="settings/email-templates" element={<SettingsEmailTemplates />} />
              {/* Scope Composer — visual SOW builder (reclaims the old /sow redirect). */}
              <Route path="sow" element={<SowList />} />
              <Route path="sow/manage" element={<SowManage />} />
              <Route path="sow/templates/:id" element={<SowComposer />} />
              <Route path="sow/docs/:id" element={<SowComposer />} />
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
