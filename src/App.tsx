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

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
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
