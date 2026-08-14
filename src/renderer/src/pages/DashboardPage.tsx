import { type ReactElement, useEffect, useMemo, useState } from "react";

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

type StartupExecutionMetadata = {
  capture_git_state?: {
    has_git?: boolean;
    run_id?: string;
  };
  check_factory?: {
    created?: boolean;
    path?: string;
  };
  read_config?: {
    locale?: string;
    mode?: string;
    version?: string;
  };
  place_inputs?: {
    baseline?: string;
    run_id?: string;
    scope?: string;
    status?: string;
  };
  select_run?: {
    decision?: string;
    run_id?: string;
  };
};

const isStartupExecutionMetadata = (value: unknown): value is StartupExecutionMetadata =>
  typeof value === "object" && value !== null;

export const DashboardPage = (): ReactElement => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const activityEntries = useJobStore((state) => state.activityEntries);
  const providers = useProviderStore((state) => state.providers);
  const settings = useSettingsStore((state) => state.settings);
  const checkCloud = useJobStore((state) => state.checkCloud);
  const cloudMessage = useJobStore((state) => state.cloudMessage);
  const currentOperation = useJobStore((state) => state.currentOperation);
  const errorMessage = useJobStore((state) => state.errorMessage);
  const isRunning = useJobStore((state) => state.isRunning);
  const lastRun = useJobStore((state) => state.lastRun);
  const loadWorkflow = useJobStore((state) => state.loadWorkflow);
  const runProgress = useJobStore((state) => state.runProgress);
  const runCloudJob = useJobStore((state) => state.runCloudJob);
  const workflow = useJobStore((state) => state.workflow);
  const [inputFileMessage, setInputFileMessage] = useState<string | null>(null);

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
  const effectiveProgress = activeStage
    ? isRunning
      ? Math.max(stageProgress(activeStage), runProgress)
      : stageProgress(activeStage)
    : 0;
  const startupExecution = useMemo(() => {
    const metadata = lastRun?.job.task?.instructions.metadata.localExecution;

    return isStartupExecutionMetadata(metadata) ? metadata : null;
  }, [lastRun]);
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

  const openStartupInputFile = async (fileName: "SCOPE.md" | "BASELINE.md"): Promise<void> => {
    const runId = startupExecution?.place_inputs?.run_id;

    if (!activeProject) {
      setInputFileMessage("No project is open.");
      return;
    }

    if (!runId) {
      setInputFileMessage("Run ID is not available yet.");
      return;
    }

    try {
      const result = await window.forgepilot.startup.openInputFile({
        fileName,
        projectRootPath: activeProject.rootPath,
        runId
      });

      setInputFileMessage(
        result.opened
          ? `${fileName} opened in the system editor.`
          : `Could not open ${fileName}: ${result.errorMessage ?? "unknown error"}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setInputFileMessage(`Could not open ${fileName}: ${message}`);
    }
  };

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
                    <span>
                      {isRunning && activeStage?.id === stage.id
                        ? "Running"
                        : statusText[stage.status]}
                    </span>
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
          <div
            className={`progress-track${isRunning ? " is-running" : ""}`}
            aria-label="Stage progress"
          >
            <span style={{ width: `${effectiveProgress}%` }} />
          </div>
          <div className="stage-detail-grid">
            <span>Agent</span>
            <strong>{activeStage?.currentAgent ?? "Not assigned"}</strong>
            <span>Operation</span>
            <strong>
              {isRunning ? currentOperation : (activeStage?.currentOperation ?? "Ready to start")}
            </strong>
            <span>Model</span>
            <strong>{selectedModel ?? "No model selected"}</strong>
          </div>

          <section className="activity-panel" aria-label="Stage activity">
            <h3>Activity</h3>
            {activityEntries.length === 0 ? (
              <p>The stage has not started yet.</p>
            ) : (
              <ol>
                {activityEntries.map((entry, index) => (
                  <li
                    className={isRunning && index === activityEntries.length - 1 ? "is-live" : ""}
                    key={entry}
                  >
                    {entry}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {startupExecution?.check_factory || startupExecution?.read_config ? (
            <section className="startup-result" aria-label="Startup execution result">
              <h3>Exe Result</h3>
              <dl>
                <div>
                  <dt>.ai-factory</dt>
                  <dd>
                    {startupExecution.check_factory?.created ? "Created" : "Already existed"} ·{" "}
                    {startupExecution.check_factory?.path ?? "path yok"}
                  </dd>
                </div>
                <div>
                  <dt>Config</dt>
                  <dd>
                    version: {startupExecution.read_config?.version ?? "unknown"} · mode:{" "}
                    {startupExecution.read_config?.mode ?? "unknown"} · locale:{" "}
                    {startupExecution.read_config?.locale ?? "tr-TR"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {startupExecution?.select_run ? (
            <section className="startup-result" aria-label="Run selection result">
              <h3>Run Selection</h3>
              <dl>
                <div>
                  <dt>Decision</dt>
                  <dd>{startupExecution.select_run.decision ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.select_run.run_id ?? "unknown"}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {startupExecution?.place_inputs ? (
            <section className="startup-result" aria-label="Place inputs result">
              <h3>Place Inputs</h3>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{startupExecution.place_inputs.status ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.place_inputs.run_id ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Files</dt>
                  <dd>
                    SCOPE.md: {startupExecution.place_inputs.scope ?? "unknown"} · BASELINE.md:{" "}
                    {startupExecution.place_inputs.baseline ?? "unknown"}
                  </dd>
                </div>
              </dl>
              {startupExecution.place_inputs.status === "waiting_for_input" ? (
                <div className="startup-input-actions">
                  <p>
                    Review SCOPE.md and BASELINE.md, remove the review marker after approval, then
                    start the stage again.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        void openStartupInputFile("SCOPE.md");
                      }}
                    >
                      Open SCOPE.md
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void openStartupInputFile("BASELINE.md");
                      }}
                    >
                      Open BASELINE.md
                    </button>
                  </div>
                  {inputFileMessage ? <span>{inputFileMessage}</span> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {startupExecution?.capture_git_state ? (
            <section className="startup-result" aria-label="Capture git state result">
              <h3>Git State</h3>
              <dl>
                <div>
                  <dt>Git</dt>
                  <dd>
                    {startupExecution.capture_git_state.has_git ? "Detected" : "Not detected"}
                  </dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.capture_git_state.run_id ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Files</dt>
                  <dd>git-head.txt · git-status.txt · working-tree.patch</dd>
                </div>
              </dl>
            </section>
          ) : null}

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
