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
  build_factory_manifest?: {
    file_count?: number;
    run_id?: string;
  };
  build_source_manifest?: {
    file_count?: number;
    run_id?: string;
  };
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
  seal_run?: {
    decision?: string;
    missing?: string[];
    pre_run_manifest_sha256?: string;
    run_id?: string;
  };
  scan_project?: {
    directory_count?: number;
    file_count?: number;
  };
  classify_files?: {
    file_count?: number;
    unknown_count?: number;
  };
  index_documents?: {
    document_count?: number;
    glossary_term_count?: number;
    missing_document_count?: number;
    reference_count?: number;
  };
  map_dependencies?: {
    package_count?: number;
    technology_count?: number;
  };
  build_context?: {
    entity_count?: number;
    module_count?: number;
    unknown_count?: number;
    user_role_count?: number;
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
  const runningStageId = useJobStore((state) => state.runningStageId);
  const runCloudJob = useJobStore((state) => state.runCloudJob);
  const workflow = useJobStore((state) => state.workflow);
  const [inputFileMessage, setInputFileMessage] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [followRunnableStage, setFollowRunnableStage] = useState(true);

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
  const runnableStage =
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "ready" || stage.status === "failed") ??
    null;
  const selectedStage =
    stages.find((stage) => stage.id === selectedStageId) ?? runnableStage ?? stages[0] ?? null;
  const selectedStageIsRunning = Boolean(
    isRunning && selectedStage && runningStageId === selectedStage.id
  );
  const canRunSelectedStage = Boolean(
    activeProject &&
      selectedProvider &&
      selectedStage &&
      !isRunning &&
      selectedStage.status !== "waiting"
  );
  const effectiveProgress = selectedStage
    ? selectedStageIsRunning
      ? Math.max(stageProgress(selectedStage), runProgress)
      : stageProgress(selectedStage)
    : 0;
  const startupExecution = useMemo(() => {
    const metadata = lastRun?.job?.task?.instructions.metadata.localExecution;

    return isStartupExecutionMetadata(metadata) ? metadata : null;
  }, [lastRun]);
  const visibleActivityEntries = useMemo(() => {
    const entries = selectedStageIsRunning
      ? activityEntries
      : (selectedStage?.activity ?? []);

    return entries.slice(-5).reverse();
  }, [activityEntries, selectedStage, selectedStageIsRunning]);
  const showLastRunDetails = lastRun?.stageOutcome.stageId === selectedStage?.id;

  useEffect(() => {
    void checkCloud();
  }, [checkCloud]);

  useEffect(() => {
    if (activeProject) {
      void loadWorkflow(activeProject.id, activeProject.rootPath);
    }
  }, [activeProject, loadWorkflow]);

  useEffect(() => {
    const currentStages = workflow?.stages ?? [];

    if (currentStages.length === 0) {
      setSelectedStageId(null);
      return;
    }

    const selectionStillExists = currentStages.some((stage) => stage.id === selectedStageId);
    const nextRunnable =
      currentStages.find((stage) => stage.status === "running") ??
      currentStages.find((stage) => stage.status === "ready" || stage.status === "failed") ??
      null;

    if (!selectionStillExists || followRunnableStage) {
      setSelectedStageId(nextRunnable?.id ?? currentStages.at(-1)?.id ?? null);
    }
  }, [followRunnableStage, selectedStageId, workflow]);

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
                    selectedStage?.id === stage.id ? " is-current" : ""
                  }`}
                  key={stage.id}
                >
                  <button
                    className="stage-tab"
                    type="button"
                    onClick={() => {
                      setFollowRunnableStage(false);
                      setSelectedStageId(stage.id);
                    }}
                  >
                    <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="stage-tab-copy">
                      <strong>{stage.name}</strong>
                      <span>
                        {isRunning && runningStageId === stage.id
                          ? "Running"
                          : statusText[stage.status]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="current-stage-panel">
          <div className="stage-panel-heading">
            <div className="section-title">
              <p className="eyebrow">Stage</p>
              <h2>{selectedStage?.name ?? "Waiting for workflow"}</h2>
            </div>
            {selectedStage ? (
              <button
                className="primary-action"
                type="button"
                disabled={!canRunSelectedStage}
                onClick={() => {
                  if (!activeProject || !selectedProvider || !selectedStage) {
                    return;
                  }

                  const restart =
                    selectedStage.status === "completed" || selectedStage.status === "failed";
                  setFollowRunnableStage(true);
                  void runCloudJob(
                    activeProject,
                    selectedProvider,
                    selectedModel,
                    selectedStage.id,
                    restart
                  );
                }}
              >
                {selectedStageIsRunning
                  ? "Running"
                  : selectedStage.status === "completed"
                    ? "Restart stage"
                    : selectedStage.status === "failed"
                      ? "Restart stage"
                      : selectedStage.status === "waiting"
                        ? "Waiting"
                        : "Start stage"}
              </button>
            ) : null}
          </div>
          <div
            className={`progress-track${selectedStageIsRunning ? " is-running" : ""}`}
            aria-label="Stage progress"
          >
            <span style={{ width: `${effectiveProgress}%` }} />
          </div>
          <div className="stage-detail-grid">
            <span>Agent</span>
            <strong>{selectedStage?.currentAgent ?? "Not assigned"}</strong>
            <span>Operation</span>
            <strong>
              {selectedStageIsRunning
                ? currentOperation
                : (selectedStage?.currentOperation ??
                  (selectedStage?.status === "waiting" ? "Waiting for previous stage" : "Ready to start"))}
            </strong>
            <span>Model</span>
            <strong>{selectedModel ?? "No model selected"}</strong>
          </div>

          <section className="activity-panel" aria-label="Stage activity">
            <h3>Activity</h3>
            {visibleActivityEntries.length === 0 ? (
              <p>The stage has not started yet.</p>
            ) : (
              <ul>
                {visibleActivityEntries.map((entry, index) => (
                  <li
                    className={`activity-item activity-item-${entry.status}${
                      isRunning && index === 0 && entry.status === "started" ? " is-live" : ""
                    }`}
                    key={entry.stepId}
                  >
                    {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedStage?.report ? (
            <section className="stage-report" aria-label="Stage final report">
              <h3>Final report</h3>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedStage.report.outcome}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>{selectedStage.report.message}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{new Date(selectedStage.report.completedAt).toLocaleString()}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && (startupExecution?.check_factory || startupExecution?.read_config) ? (
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

          {showLastRunDetails && startupExecution?.select_run ? (
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

          {showLastRunDetails && startupExecution?.place_inputs ? (
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

          {showLastRunDetails && startupExecution?.capture_git_state ? (
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

          {showLastRunDetails && startupExecution?.build_source_manifest ? (
            <section className="startup-result" aria-label="Source manifest result">
              <h3>Source Manifest</h3>
              <dl>
                <div>
                  <dt>Files</dt>
                  <dd>{startupExecution.build_source_manifest.file_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.build_source_manifest.run_id ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>SOURCE_MANIFEST.csv</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.build_factory_manifest ? (
            <section className="startup-result" aria-label="Factory manifest result">
              <h3>Factory Manifest</h3>
              <dl>
                <div>
                  <dt>Files</dt>
                  <dd>{startupExecution.build_factory_manifest.file_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.build_factory_manifest.run_id ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>FACTORY_MANIFEST.csv</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.seal_run ? (
            <section className="startup-result" aria-label="Run seal result">
              <h3>Run Seal</h3>
              <dl>
                <div>
                  <dt>Decision</dt>
                  <dd>{startupExecution.seal_run.decision ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{startupExecution.seal_run.run_id ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Manifest</dt>
                  <dd>{startupExecution.seal_run.pre_run_manifest_sha256 ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Missing</dt>
                  <dd>
                    {startupExecution.seal_run.missing?.length
                      ? startupExecution.seal_run.missing.join(", ")
                      : "None"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.scan_project ? (
            <section className="startup-result" aria-label="Scan project result">
              <h3>Project Scan</h3>
              <dl>
                <div>
                  <dt>Files</dt>
                  <dd>{startupExecution.scan_project.file_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Directories</dt>
                  <dd>{startupExecution.scan_project.directory_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>FILE_INVENTORY.json · FOLDER_STRUCTURE.json</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.classify_files ? (
            <section className="startup-result" aria-label="Classify files result">
              <h3>File Classification</h3>
              <dl>
                <div>
                  <dt>Classified</dt>
                  <dd>{startupExecution.classify_files.file_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Unknown</dt>
                  <dd>{startupExecution.classify_files.unknown_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>CLASSIFIED_FILES.json · UNKNOWN_FILES.json</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.index_documents ? (
            <section className="startup-result" aria-label="Document index result">
              <h3>Document Index</h3>
              <dl>
                <div>
                  <dt>Documents</dt>
                  <dd>{startupExecution.index_documents.document_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>References</dt>
                  <dd>{startupExecution.index_documents.reference_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Missing documents</dt>
                  <dd>{startupExecution.index_documents.missing_document_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Glossary terms</dt>
                  <dd>{startupExecution.index_documents.glossary_term_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>
                    DOCUMENT_INDEX.json · DOCUMENT_STRUCTURE.json · DOCUMENT_REFERENCES.json ·
                    MISSING_DOCUMENTS.json · DOMAIN_GLOSSARY.json
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.map_dependencies ? (
            <section className="startup-result" aria-label="Dependency map result">
              <h3>Dependency Map</h3>
              <dl>
                <div>
                  <dt>Packages</dt>
                  <dd>{startupExecution.map_dependencies.package_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Technologies</dt>
                  <dd>{startupExecution.map_dependencies.technology_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>DEPENDENCY_MAP.json · TECHNOLOGY_STACK.json</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {showLastRunDetails && startupExecution?.build_context ? (
            <section className="startup-result" aria-label="Project context result">
              <h3>Project Context</h3>
              <dl>
                <div>
                  <dt>Modules</dt>
                  <dd>{startupExecution.build_context.module_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Entities</dt>
                  <dd>{startupExecution.build_context.entity_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>User roles</dt>
                  <dd>{startupExecution.build_context.user_role_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Unresolved fields</dt>
                  <dd>{startupExecution.build_context.unknown_count ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>PROJECT_CONTEXT.json · MODULE_MAP_BASE.json</dd>
                </div>
              </dl>
            </section>
          ) : null}


        </div>
      </section>

      <ProviderPanel />
    </div>
  );
};
