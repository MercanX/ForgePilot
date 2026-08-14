import { type ReactElement, useEffect, useMemo } from "react";

import { ProviderPanel } from "@renderer/components/ProviderPanel";
import { useJobStore } from "@renderer/stores/jobStore";
import { useProjectStore } from "@renderer/stores/projectStore";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";
import type { WorkflowStage } from "@shared/schemas/run";

const statusText: Record<WorkflowStage["status"], string> = {
  completed: "Completed",
  failed: "Failed",
  ready: "Ready",
  running: "Running",
  skipped: "Skipped",
  waiting: "Waiting"
};

const stageProgress = (stage: WorkflowStage): number => {
  if (stage.progress !== null) {
    return stage.progress;
  }

  return stage.status === "completed" ? 100 : 0;
};

export const DashboardPage = (): ReactElement => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const providers = useProviderStore((state) => state.providers);
  const settings = useSettingsStore((state) => state.settings);
  const checkCloud = useJobStore((state) => state.checkCloud);
  const cloudMessage = useJobStore((state) => state.cloudMessage);
  const errorMessage = useJobStore((state) => state.errorMessage);
  const isRunning = useJobStore((state) => state.isRunning);
  const lastRun = useJobStore((state) => state.lastRun);
  const loadWorkflow = useJobStore((state) => state.loadWorkflow);
  const runCloudJob = useJobStore((state) => state.runCloudJob);
  const workflow = useJobStore((state) => state.workflow);

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
  const stages = workflow?.stages ?? [];
  const activeStage =
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "ready") ??
    stages[0] ??
    null;
  const canStart = Boolean(activeProject && selectedProvider && activeStage && !isRunning);
  const validationJson = useMemo(() => {
    const text = lastRun?.result.outputChunks.map((chunk) => chunk.text).join("") ?? "";
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const jsonLine = [...lines]
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));

    if (!jsonLine) {
      return null;
    }

    try {
      return JSON.parse(jsonLine) as unknown;
    } catch {
      return null;
    }
  }, [lastRun]);

  useEffect(() => {
    void checkCloud();
  }, [checkCloud]);

  useEffect(() => {
    if (activeProject) {
      void loadWorkflow(activeProject.id);
    }
  }, [activeProject, loadWorkflow]);

  if (!activeProject) {
    return (
      <div className="dashboard-page">
        <section className="empty-projects">
          <h2>No project opened</h2>
          <p>Open a local project from Projects to prepare its AI Factory stages.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">AI Factory</p>
          <h1 id="workspace-title">{activeProject.name}</h1>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!canStart}
          onClick={() => {
            if (activeProject && selectedProvider) {
              void runCloudJob(
                activeProject,
                selectedProvider,
                selectedModel,
                activeStage?.id ?? null
              );
            }
          }}
        >
          {isRunning ? "Running" : activeStage ? `Start ${activeStage.name}` : "Start"}
        </button>
      </header>

      <section className="dashboard-summary" aria-live="polite">
        <span>Project: {activeProject.rootPath}</span>
        <span>Cloud: {cloudMessage}</span>
        <span>Provider: {selectedProvider?.label ?? "No installed provider"}</span>
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <section className="dashboard-grid" aria-label="Project workflow">
        <div className="stage-rail">
          <div className="section-title">
            <p className="eyebrow">Stages</p>
            <h2>{workflow ? `${workflow.workflowId} ${workflow.workflowVersion}` : "Workflow"}</h2>
          </div>
          {stages.length === 0 ? (
            <p className="provider-empty">Mock cloud is not returning a workflow yet.</p>
          ) : (
            <ol className="stage-list">
              {stages.map((stage, index) => (
                <li
                  className={`stage-item stage-item-${stage.status}${
                    activeStage?.id === stage.id ? " is-current" : ""
                  }`}
                  key={stage.id}
                >
                  <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{stage.name}</strong>
                    <span>{statusText[stage.status]}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="current-stage-panel">
          <div className="section-title">
            <p className="eyebrow">Current stage</p>
            <h2>{activeStage?.name ?? "Waiting for workflow"}</h2>
          </div>
          <div className="progress-track" aria-label="Stage progress">
            <span style={{ width: `${activeStage ? stageProgress(activeStage) : 0}%` }} />
          </div>
          <div className="stage-detail-grid">
            <span>Agent</span>
            <strong>{activeStage?.currentAgent ?? "Not assigned"}</strong>
            <span>Operation</span>
            <strong>{activeStage?.currentOperation ?? "Ready to start"}</strong>
            <span>Model</span>
            <strong>{selectedModel ?? "No model selected"}</strong>
          </div>
          <pre className="task-output" aria-live="polite">
            {validationJson
              ? JSON.stringify(validationJson, null, 2)
              : lastRun
                ? [
                    `Job: ${lastRun.job.id}\n`,
                    `Stage: ${lastRun.job.stageId}\n`,
                    `Status: ${lastRun.result.status}\n`,
                    `Exit code: ${lastRun.result.exitCode ?? "n/a"}\n`,
                    lastRun.result.outputChunks
                      .map((chunk) => `[${chunk.stream}] ${chunk.text}`)
                      .join("")
                  ].join("")
                : "The first stage will request a cloud job and open the selected LLM provider process."}
          </pre>
        </div>
      </section>

      <ProviderPanel />
    </div>
  );
};
