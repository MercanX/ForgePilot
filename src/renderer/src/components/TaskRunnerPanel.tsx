import { type ReactElement, useMemo, useState } from "react";

import { useProjectStore } from "@renderer/stores/projectStore";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";
import { useTaskStore } from "@renderer/stores/taskStore";

export const TaskRunnerPanel = (): ReactElement => {
  const [instructions, setInstructions] = useState(
    "Summarize this workspace in one short sentence."
  );
  const activeProject = useProjectStore((state) => state.activeProject);
  const projects = useProjectStore((state) => state.projects);
  const providers = useProviderStore((state) => state.providers);
  const settings = useSettingsStore((state) => state.settings);
  const errorMessage = useTaskStore((state) => state.errorMessage);
  const isRunning = useTaskStore((state) => state.isRunning);
  const lines = useTaskStore((state) => state.lines);
  const startEchoTask = useTaskStore((state) => state.startEchoTask);
  const stopTask = useTaskStore((state) => state.stopTask);
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
  const canStart = Boolean(
    selectedProject && selectedProvider && instructions.trim() && !isRunning
  );

  return (
    <section className="task-runner-panel" aria-labelledby="task-runner-title">
      <div className="task-runner-heading">
        <div>
          <p className="eyebrow">Process runner</p>
          <h2 id="task-runner-title">Manual Task Fixture</h2>
        </div>
        <div className="task-runner-actions">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => {
              if (selectedProject && selectedProvider) {
                void startEchoTask(selectedProject, selectedProvider, instructions, selectedModel);
              }
            }}
          >
            Run Echo
          </button>
          <button type="button" disabled={!isRunning} onClick={() => void stopTask()}>
            Stop
          </button>
        </div>
      </div>

      <div className="task-runner-context">
        <span>Project: {selectedProject?.name ?? "No project selected"}</span>
        <span>Provider: {selectedProvider?.label ?? "No installed provider"}</span>
        <span>Model: {selectedModel ?? "No model selected"}</span>
      </div>

      <textarea
        value={instructions}
        disabled={isRunning}
        onChange={(event) => setInstructions(event.target.value)}
        aria-label="Task instructions"
      />

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <pre className="task-output" aria-live="polite">
        {lines.length === 0
          ? "Run Echo starts a real child process without calling an AI provider."
          : lines.map((line) => `[${line.stream}] ${line.text}`).join("")}
      </pre>
    </section>
  );
};
