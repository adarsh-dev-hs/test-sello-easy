import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import AppShell from "./components/AppShell";
import { LoginPage, RegisterPage } from "./pages/Auth";
import WorkspacesPage from "./pages/Workspaces";
import OnboardingPage from "./pages/Onboarding";
import McpServersPage from "./pages/McpServers";
import CompanyLayout from "./pages/company/CompanyLayout";
import FeedPage from "./pages/company/Feed";
import ProfilePage from "./pages/company/Profile";
import IcpPage from "./pages/company/Icp";
import SignalsPage from "./pages/company/Signals";
import SourcesPage from "./pages/company/Sources";
import RunsPage from "./pages/company/Runs";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  const loc = useLocation();
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<WorkspacesPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="settings/mcp" element={<McpServersPage />} />
        <Route path="c/:cid" element={<CompanyLayout />}>
          <Route index element={<FeedPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="icp" element={<IcpPage />} />
          <Route path="signals" element={<SignalsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="runs" element={<RunsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
