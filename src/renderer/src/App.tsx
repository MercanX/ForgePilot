import { useEffect, useState } from "react";
import type { ReactElement } from "react";

export const App = (): ReactElement => {
  const [bridgeStatus, setBridgeStatus] = useState("Checking preload bridge");

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
          <span>Provider: Not selected</span>
          <span>v0.1.0</span>
        </header>
        <div className="empty-state">
          <p className="eyebrow">Desktop client foundation</p>
          <h1 id="workspace-title">ForgePilot is ready for the first workflow layer.</h1>
          <p>The Electron, React, TypeScript, lint, format and test toolchain is now scaffolded.</p>
          <p className="bridge-status">{bridgeStatus}</p>
        </div>
      </section>
    </main>
  );
};
