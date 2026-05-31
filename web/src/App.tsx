import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { Dashboard } from "./pages/Dashboard";
import { DashboardComposer } from "./pages/DashboardComposer";
import { Ingest } from "./pages/Ingest";
import { MetricBuilder } from "./pages/MetricBuilder";
import { ReportBuilder } from "./pages/ReportBuilder";
import { Login } from "./pages/Login";

type Tab = "dashboard" | "report" | "compose" | "metrics" | "ingest";

const TABS: { id: Tab; label: string; adminOnly: boolean }[] = [
  { id: "dashboard", label: "Dashboard", adminOnly: false },
  { id: "report", label: "New report", adminOnly: false },
  { id: "compose", label: "Compose", adminOnly: true },
  { id: "metrics", label: "SQL metric", adminOnly: true },
  { id: "ingest", label: "Datasets", adminOnly: true },
];

export default function App() {
  const qc = useQueryClient();
  const auth = useQuery({ queryKey: ["auth"], queryFn: api.me });
  const [tab, setTab] = useState<Tab>("dashboard");

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });

  if (auth.isLoading) return <div className="login-wrap muted">Loading…</div>;

  const user = auth.data?.user ?? null;
  if (!user) return <Login needsBootstrap={auth.data?.needsBootstrap ?? false} />;

  const isAdmin = user.role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : "dashboard";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">rpt-dash</div>
        <nav>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              className={t.id === activeTab ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="user-box">
          <span className="muted">
            {user.username} <span className="badge">{user.role}</span>
          </span>
          <button className="link" onClick={() => logout.mutate()}>
            sign out
          </button>
        </div>
      </header>
      <main className="content">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "report" && <ReportBuilder />}
        {activeTab === "compose" && isAdmin && <DashboardComposer />}
        {activeTab === "metrics" && isAdmin && <MetricBuilder />}
        {activeTab === "ingest" && isAdmin && <Ingest />}
      </main>
    </div>
  );
}
