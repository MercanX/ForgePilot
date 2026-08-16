import { type ReactElement, useEffect, useState } from "react";

import { DashboardPage } from "@renderer/pages/DashboardPage";
import { ProjectsPage } from "@renderer/pages/ProjectsPage";
import { SettingsPage } from "@renderer/pages/SettingsPage";
import { useProjectStore } from "@renderer/stores/projectStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";

type AppPage = "dashboard" | "projects" | "settings";

export const App = (): ReactElement => {
  const [activePage, setActivePage] = useState<AppPage>("projects");
  const [bridgeStatus, setBridgeStatus] = useState("Checking preload bridge");
  const activeProject = useProjectStore((state) => state.activeProject);
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    void loadSettings();
    void window.forgepilot.app
      .ping()
      .then((response) => {
        setBridgeStatus(`${response.appName} ${response.version} bridge ready`);
      })
      .catch(() => {
        setBridgeStatus("Preload bridge unavailable");
      });
  }, [loadSettings]);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="ForgePilot navigation">
        <div className="brand">ForgePilot</div>
        <nav>
          <button
            className={`nav-item${activePage === "projects" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActivePage("projects")}
          >
            Projects
          </button>
          <button
            className={`nav-item${activePage === "dashboard" ? " is-active" : ""}`}
            type="button"
            disabled={!activeProject}
            onClick={() => setActivePage("dashboard")}
          >
            Dashboard
          </button>
          <button className="nav-item" type="button" disabled>
            Findings
          </button>
          <button className="nav-item" type="button" disabled>
            Runs
          </button>
          <button className="nav-item" type="button" disabled>
            Logs
          </button>
          <button
            className={`nav-item${activePage === "settings" ? " is-active" : ""}`}
            type="button"
            onClick={() => setActivePage("settings")}
          >
            Settings
          </button>
        </nav>
      </aside>
      <section className="workspace" aria-labelledby="workspace-title">
        <header className="status-bar">
          <span>{bridgeStatus}</span>
        </header>
        {activePage === "projects" ? (
          <ProjectsPage onProjectOpened={() => setActivePage("dashboard")} />
        ) : null}
        {activePage === "dashboard" ? <DashboardPage /> : null}
        {activePage === "settings" ? <SettingsPage /> : null}
      </section>
    </main>
  );
};
