// src/App.tsx
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { AuthProvider } from "@/context/AuthContext";
import { Login } from "@/pages/Login";
import { DashboardPage } from "@/pages/DashboardPage";

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
            {/* Dashboard — standalone IDE layout, no AppShell */}
            <Route index element={<DashboardPage />} />

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
              <Route path="pulse" element={<PulseView />} />
              <Route path="reconciliation" element={<ReconciliationView />} />
              <Route path="productivity" element={<ProductivityPage />} />
              <Route path="guides" element={<Guides />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
