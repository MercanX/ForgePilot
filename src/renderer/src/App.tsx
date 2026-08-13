import { type ReactElement, useEffect, useState } from "react";

import { ProjectsPage } from "@renderer/pages/ProjectsPage";
import { useProviderStore } from "@renderer/stores/providerStore";

export const App = (): ReactElement => {
  const [bridgeStatus, setBridgeStatus] = useState("Checking preload bridge");
  const providers = useProviderStore((state) => state.providers);
  const installedProvider = providers.find((provider) => provider.installed);

  useEffect(() => {
    void window.forgepilot.app
      .ping()
      .then((response) => {
        setBridgeStatus(`${response.appName} ${response.version} bridge ready`);
      })
      .catch(() => {
        setBridgeStatus("Preload bridge unavailable");
      });
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="ForgePilot navigation">
        <div className="brand">ForgePilot</div>
        <nav>
          <button className="nav-item is-active" type="button">
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
        </nav>
      </aside>
      <section className="workspace" aria-labelledby="workspace-title">
        <header className="status-bar">
          <span>Cloud: Not connected</span>
          <span>Provider: {installedProvider?.label ?? "Not selected"}</span>
          <span>{bridgeStatus}</span>
        </header>
        <ProjectsPage />
      </section>
    </main>
  );
};
