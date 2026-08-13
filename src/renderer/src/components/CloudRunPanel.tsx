import { type ReactElement, useEffect, useMemo } from "react";

import { useJobStore } from "@renderer/stores/jobStore";
import { useProjectStore } from "@renderer/stores/projectStore";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";

export const CloudRunPanel = (): ReactElement => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const projects = useProjectStore((state) => state.projects);
  const providers = useProviderStore((state) => state.providers);
  const settings = useSettingsStore((state) => state.settings);
  const checkCloud = useJobStore((state) => state.checkCloud);
  const cloudMessage = useJobStore((state) => state.cloudMessage);
  const errorMessage = useJobStore((state) => state.errorMessage);
  const isRunning = useJobStore((state) => state.isRunning);
  const lastRun = useJobStore((state) => state.lastRun);
  const runCloudJob = useJobStore((state) => state.runCloudJob);
  const selectedProject = activeProject ?? projects[0] ?? null;
  const selectedProvider = useMemo(
    () =>
      providers.find(
        (provider) => provider.id === settings.activeProviderId && provider.installed
      ) ??
      providers.find((provider) => provider.installed) ??
      null,
    [providers, settings.activeProviderId]
  );
  const selectedModel = selectedProvider ? settings.providerModels[selectedProvider.id] : null;
  const canRun = Boolean(selectedProject && selectedProvider && !isRunning);

  useEffect(() => {
    void checkCloud();
  }, [checkCloud]);

  return (
    <section className="cloud-run-panel" aria-labelledby="cloud-run-title">
      <div className="task-runner-heading">
        <div>
          <p className="eyebrow">AI Factory Cloud</p>
          <h2 id="cloud-run-title">Mock Cloud Run</h2>
        </div>
        <div className="task-runner-actions">
          <button type="button" disabled={isRunning} onClick={() => void checkCloud()}>
            Check Cloud
          </button>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => {
              if (selectedProject && selectedProvider) {
                void runCloudJob(selectedProject, selectedProvider, selectedModel);
              }
            }}
          >
            Run Cloud Job
          </button>
        </div>
      </div>

      <div className="task-runner-context">
        <span>Cloud: {cloudMessage}</span>
        <span>Project: {selectedProject?.name ?? "No project selected"}</span>
        <span>Provider: {selectedProvider?.label ?? "No installed provider"}</span>
        <span>Model: {selectedModel ?? "No model selected"}</span>
      </div>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <pre className="task-output" aria-live="polite">
        {lastRun
          ? [
              `Job: ${lastRun.job.id}\n`,
              `Status: ${lastRun.result.status}\n`,
              `Exit code: ${lastRun.result.exitCode ?? "n/a"}\n`,
              `Submitted: ${lastRun.submitAccepted ? "yes" : "no"}\n`,
              lastRun.result.outputChunks.map((chunk) => `[${chunk.stream}] ${chunk.text}`).join("")
            ].join("")
          : "Start the mock cloud server, then run a cloud job through the selected provider."}
      </pre>
    </section>
  );
};
