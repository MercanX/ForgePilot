import { type ReactElement, useEffect, useState } from "react";

import { ProjectsPage } from "@renderer/pages/ProjectsPage";
import { SettingsPage } from "@renderer/pages/SettingsPage";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";

type AppPage = "projects" | "settings";

export const App = (): ReactElement => {
  const [activePage, setActivePage] = useState<AppPage>("projects");
  const [bridgeStatus, setBridgeStatus] = useState("Checking preload bridge");
  const providers = useProviderStore((state) => state.providers);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const settings = useSettingsStore((state) => state.settings);
  const selectedProvider =
    providers.find((provider) => provider.id === settings.activeProviderId) ??
    providers.find((provider) => provider.installed);

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
          <button className="nav-item" type="button" disabled>
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
          <span>Cloud: Not connected</span>
          <span>Provider: {selectedProvider?.label ?? "Not selected"}</span>
          <span>{bridgeStatus}</span>
        </header>
        {activePage === "projects" ? <ProjectsPage /> : <SettingsPage />}
      </section>
    </main>
  );
};
