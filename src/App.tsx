import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { ServicesList } from "@/pages/ServicesList";
import { ServiceDetail } from "@/pages/ServiceDetail";
import { Rules } from "@/pages/Rules";
import { Departments } from "@/pages/Departments";
import { Team } from "@/pages/Team";
import { Inbox } from "@/pages/Inbox";
import { NewBrief } from "@/pages/NewBrief";
import { Scope } from "@/pages/Scope";
import { ProjectBuilder } from "@/pages/ProjectBuilder";
import { QuoteSend } from "@/pages/QuoteSend";
import { QuoteDetail } from "@/pages/QuoteDetail";
import { Projects } from "@/pages/Projects";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Settings } from "@/pages/Settings";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="briefs/new" element={<NewBrief />} />
            <Route path="briefs/:id/scope" element={<Scope />} />
            <Route path="briefs/:id/builder" element={<ProjectBuilder />} />
            <Route path="quotes/:id" element={<QuoteDetail />} />
            <Route path="quotes/:id/send" element={<QuoteSend />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="services" element={<ServicesList />} />
            <Route path="services/new" element={<ServiceDetail mode="new" />} />
            <Route path="services/:id" element={<ServiceDetail mode="edit" />} />
            <Route path="rules" element={<Rules />} />
            <Route path="departments" element={<Departments />} />
            <Route path="team" element={<Team />} />
          </Route>
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
