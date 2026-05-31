import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { DashboardComposer } from "./pages/DashboardComposer";
import { Ingest } from "./pages/Ingest";
import { MetricBuilder } from "./pages/MetricBuilder";

type Tab = "dashboard" | "compose" | "metrics" | "ingest";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "compose", label: "Compose" },
  { id: "metrics", label: "Metric builder" },
  { id: "ingest", label: "Datasets" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">rpt-dash</div>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "compose" && <DashboardComposer />}
        {tab === "metrics" && <MetricBuilder />}
        {tab === "ingest" && <Ingest />}
      </main>
    </div>
  );
}
