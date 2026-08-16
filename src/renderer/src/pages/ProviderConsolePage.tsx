import { type ReactElement, useMemo, useState } from "react";

import { useJobStore } from "@renderer/stores/jobStore";
import { useProjectStore } from "@renderer/stores/projectStore";
import { useProviderStore } from "@renderer/stores/providerStore";

type ConsoleTab = "live" | "raw";

const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
};

export const ProviderConsolePage = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<ConsoleTab>("live");
  const activeProject = useProjectStore((state) => state.activeProject);
  const providers = useProviderStore((state) => state.providers);
  const debugEvents = useJobStore((state) => state.debugEvents);
  const clearDebugEvents = useJobStore((state) => state.clearDebugEvents);
  const isRunning = useJobStore((state) => state.isRunning);
  const runningStageId = useJobStore((state) => state.runningStageId);

  const latestEvent = debugEvents.at(-1) ?? null;
  const providerLabel = latestEvent
    ? providers.find((provider) => provider.id === latestEvent.providerId)?.label ?? latestEvent.providerId
    : "No provider run yet";
  const rawOutput = useMemo(
    () =>
      debugEvents
        .filter((event) => (event.kind === "stdout" || event.kind === "stderr") && event.text)
        .map(
          (event) =>
            `[${formatTime(event.timestamp)}] [${event.kind.toUpperCase()}]\n${event.text ?? ""}`
        )
        .join("\n"),
    [debugEvents]
  );

  return (
    <div className="provider-console-page">
      <header className="workspace-heading provider-console-heading">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h1>Provider Console</h1>
        </div>
        <button type="button" disabled={debugEvents.length === 0} onClick={clearDebugEvents}>
          Clear console
        </button>
      </header>

      <p className="provider-console-note">
        Live provider-visible process output, exit status, JSON parsing and contract validation.
        Hidden model reasoning is not exposed.
      </p>

      <dl className="provider-console-summary">
        <div>
          <dt>Project</dt>
          <dd>{activeProject?.name ?? "No project selected"}</dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd>{latestEvent?.stageId ?? runningStageId ?? "No active stage"}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{providerLabel}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{latestEvent?.model ?? "Default"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{isRunning ? "Running" : debugEvents.length > 0 ? "Stopped" : "Idle"}</dd>
        </div>
      </dl>

      <div className="provider-console-tabs" role="tablist" aria-label="Provider console views">
        <button
          className={activeTab === "live" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={activeTab === "live"}
          onClick={() => setActiveTab("live")}
        >
          Live Console
        </button>
        <button
          className={activeTab === "raw" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={activeTab === "raw"}
          onClick={() => setActiveTab("raw")}
        >
          Final Raw Output
        </button>
      </div>

      {activeTab === "live" ? (
        <section className="provider-console" aria-live="polite" aria-label="Live provider console">
          {debugEvents.length === 0 ? (
            <p className="provider-console-empty">
              Start a stage. Provider process activity will appear here while Claude Code or Codex runs.
            </p>
          ) : (
            debugEvents.map((event, index) => (
              <div className={`provider-console-entry provider-console-${event.kind}`} key={`${event.timestamp}:${event.kind}:${index}`}>
                <div className="provider-console-entry-meta">
                  <span>{formatTime(event.timestamp)}</span>
                  <strong>{event.kind}</strong>
                  {event.taskId ? <span>task {event.taskId.slice(0, 8)}</span> : null}
                  {event.processId ? <span>pid {event.processId}</span> : null}
                </div>
                <div className="provider-console-entry-message">{event.message}</div>
                {event.text ? <pre>{event.text}</pre> : null}
                {event.kind === "provider-exit" ? (
                  <div className="provider-console-entry-exit">
                    exit={event.exitCode ?? "null"} signal={event.signal ?? "none"}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </section>
      ) : (
        <section className="provider-console" aria-label="Raw provider output">
          <pre className="provider-console-raw">
            {rawOutput || "No stdout/stderr has been captured for the current run."}
          </pre>
        </section>
      )}
    </div>
  );
};
