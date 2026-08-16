import { type ReactElement, useEffect, useMemo, useState } from "react";

import { useJobStore } from "@renderer/stores/jobStore";
import { useProjectStore } from "@renderer/stores/projectStore";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";
import type { WorkflowStage } from "@shared/schemas/run";
import type { StartupState } from "@shared/schemas/startup";

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
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [followRunnableStage, setFollowRunnableStage] = useState(true);
  const [startupState, setStartupState] = useState<StartupState | null>(null);
  const [scopeIncludeText, setScopeIncludeText] = useState("");
  const [scopeExcludeText, setScopeExcludeText] = useState("");
  const [scopeExplicitFilesText, setScopeExplicitFilesText] = useState("");
  const [startupMessage, setStartupMessage] = useState<string | null>(null);

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
  const cloudConnected = cloudMessage.toLowerCase().includes("connected");
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
  const startupAwaitingApproval = Boolean(
    selectedStage?.id === "010-startup" && startupState?.scope?.status === "pending_approval"
  );
  const canRunSelectedStage = Boolean(
    activeProject &&
      selectedProvider &&
      selectedStage &&
      !isRunning &&
      selectedStage.status !== "waiting" &&
      !startupAwaitingApproval
  );
  const effectiveProgress = selectedStage
    ? selectedStageIsRunning
      ? Math.max(stageProgress(selectedStage), runProgress)
      : stageProgress(selectedStage)
    : 0;
  const visibleActivityEntries = useMemo(() => {
    const entries = selectedStageIsRunning
      ? activityEntries
      : (selectedStage?.activity ?? []);

    return entries.slice(-5).reverse();
  }, [activityEntries, selectedStage, selectedStageIsRunning]);

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

  useEffect(() => {
    if (!activeProject || selectedStage?.id !== "010-startup") {
      setStartupState(null);
      return;
    }

    void window.forgepilot.startup
      .getState({ projectRootPath: activeProject.rootPath })
      .then((next) => setStartupState(next))
      .catch(() => setStartupState(null));
  }, [activeProject, lastRun, selectedStage?.id, workflow]);

  useEffect(() => {
    const scope = startupState?.scope;
    if (!scope) {
      setScopeIncludeText("");
      setScopeExcludeText("");
      setScopeExplicitFilesText("");
      return;
    }

    const approved = scope.approved;
    setScopeIncludeText(
      (approved?.include ?? scope.proposal.include.map((item) => item.path)).join("\n")
    );
    setScopeExcludeText(
      (approved?.exclude ?? scope.proposal.exclude.map((item) => item.path)).join("\n")
    );
    setScopeExplicitFilesText((approved?.explicit_files ?? []).join("\n"));
  }, [startupState?.scope]);

  const loadStartupState = async (): Promise<void> => {
    if (!activeProject) {
      setStartupState(null);
      return;
    }

    try {
      const next = await window.forgepilot.startup.getState({
        projectRootPath: activeProject.rootPath
      });
      setStartupState(next);
    } catch (error) {
      setStartupMessage(error instanceof Error ? error.message : "Could not read Startup state.");
    }
  };

  const parseScopeText = (value: string): string[] =>
    [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];

  const normalizeUiScopePath = (value: string): string =>
    value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/g, "");

  const pathMatchesOrIsBelow = (relativePath: string, scopePath: string): boolean => {
    const relative = normalizeUiScopePath(relativePath);
    const scope = normalizeUiScopePath(scopePath);
    return scope === "." || relative === scope || relative.startsWith(`${scope}/`);
  };

  const unresolvedStartupDecisions = startupState?.scope
    ? startupState.scope.proposal.needs_user_decision.filter((decision) => {
        const decisionPath = normalizeUiScopePath(decision.path);
        const include = parseScopeText(scopeIncludeText);
        const exclude = parseScopeText(scopeExcludeText);
        const explicitFiles = parseScopeText(scopeExplicitFilesText);

        const included = include.some((candidate) => pathMatchesOrIsBelow(decisionPath, candidate));
        const excluded = exclude.some((candidate) => pathMatchesOrIsBelow(decisionPath, candidate));
        const explicit = explicitFiles.some(
          (candidate) =>
            normalizeUiScopePath(candidate) === decisionPath ||
            pathMatchesOrIsBelow(candidate, decisionPath)
        );

        return !included && !excluded && !explicit;
      })
    : [];

  const resolveStartupDecision = (path: string, target: "include" | "exclude"): void => {
    const normalized = normalizeUiScopePath(path);
    const include = parseScopeText(scopeIncludeText).filter(
      (candidate) => normalizeUiScopePath(candidate) !== normalized
    );
    const exclude = parseScopeText(scopeExcludeText).filter(
      (candidate) => normalizeUiScopePath(candidate) !== normalized
    );

    if (target === "include") {
      include.push(normalized);
    } else {
      exclude.push(normalized);
    }

    setScopeIncludeText([...new Set(include)].join("\n"));
    setScopeExcludeText([...new Set(exclude)].join("\n"));
    setStartupMessage(null);
  };

  const approveScopeAndContinue = async (): Promise<void> => {
    if (!activeProject || !selectedProvider) {
      return;
    }

    try {
      setStartupMessage("Approving scope...");
      await window.forgepilot.startup.approveScope({
        approved: {
          exclude: parseScopeText(scopeExcludeText),
          explicit_files: parseScopeText(scopeExplicitFilesText),
          include: parseScopeText(scopeIncludeText)
        },
        projectRootPath: activeProject.rootPath
      });
      setStartupMessage("Scope approved. Building and sealing the workspace...");
      await runCloudJob(
        activeProject,
        selectedProvider,
        selectedModel,
        "010-startup",
        false
      );
      await loadStartupState();
    } catch (error) {
      setStartupMessage(error instanceof Error ? error.message : "Scope approval failed.");
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

      <section className="dashboard-summary" aria-label="Runtime summary" aria-live="polite">
        <dl className="dashboard-summary-grid">
          <div className="dashboard-summary-card dashboard-summary-card-wide summary-card-project">
            <dt>Project</dt>
            <dd>{activeProject.rootPath}</dd>
          </div>
          <div className="dashboard-summary-status">
            <div
              className={`dashboard-summary-card ${
                cloudConnected ? "summary-card-connected" : "summary-card-warning"
              }`}
            >
              <dt>Cloud</dt>
              <dd>{cloudMessage}</dd>
            </div>
            <div
              className={`dashboard-summary-card ${
                selectedProvider ? "summary-card-connected" : "summary-card-warning"
              }`}
            >
              <dt>Provider</dt>
              <dd>{selectedProvider?.label ?? "No installed provider"}</dd>
            </div>
            <div
              className={`dashboard-summary-card ${
                selectedModel ? "summary-card-connected" : "summary-card-warning"
              }`}
            >
              <dt>Model</dt>
              <dd>{selectedModel ?? "No model selected"}</dd>
            </div>
          </div>
        </dl>
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
                  : startupAwaitingApproval
                    ? "Approve scope below"
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

          {selectedStage?.id === "010-startup" ? (
            <section className="startup-scope-panel" aria-label="Startup audit scope">
              <div className="startup-scope-heading">
                <div>
                  <h3>Audit scope</h3>
                  <p>AI proposes the boundary. You are the final authority.</p>
                </div>
                {startupState?.seal ? (
                  <span className="startup-seal-badge">READY FOR DISCOVERY</span>
                ) : null}
              </div>

              {!startupState?.scope ? (
                <p>Start 010-Startup to let the selected AI inspect the project and propose scope.</p>
              ) : (
                <>
                  <p className="startup-scope-summary">{startupState.scope.proposal.summary}</p>

                  <div className="startup-proposal-grid">
                    <div>
                      <strong>AI recommends include</strong>
                      <ul>
                        {startupState.scope.proposal.include.map((item) => (
                          <li key={`include:${item.path}`}>
                            <code>{item.path}</code> — {item.reason} ({item.confidence})
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>AI recommends exclude</strong>
                      <ul>
                        {startupState.scope.proposal.exclude.map((item) => (
                          <li key={`exclude:${item.path}`}>
                            <code>{item.path}</code> — {item.reason} ({item.confidence})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {startupState.scope.proposal.needs_user_decision.length > 0 ? (
                    <div className="startup-decision-list">
                      <div className="startup-decision-heading">
                        <strong>Needs your decision</strong>
                        <span>{unresolvedStartupDecisions.length} remaining</span>
                      </div>

                      {unresolvedStartupDecisions.length > 0 ? (
                        <ul>
                          {unresolvedStartupDecisions.map((item) => (
                            <li key={`${item.path}:${item.reason}`} className="startup-decision-item">
                              <div className="startup-decision-copy">
                                <code>{item.path}</code>
                                <span>{item.reason} ({item.confidence})</span>
                              </div>
                              <div className="startup-decision-actions">
                                <button
                                  type="button"
                                  disabled={isRunning || Boolean(startupState.seal)}
                                  onClick={() => resolveStartupDecision(item.path, "include")}
                                >
                                  Include
                                </button>
                                <button
                                  type="button"
                                  disabled={isRunning || Boolean(startupState.seal)}
                                  onClick={() => resolveStartupDecision(item.path, "exclude")}
                                >
                                  Exclude
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="startup-decisions-resolved">✓ All AI uncertainties resolved.</p>
                      )}
                    </div>
                  ) : null}

                  <div className="startup-scope-editors">
                    <label>
                      Include
                      <textarea
                        disabled={Boolean(startupState.seal)}
                        value={scopeIncludeText}
                        onChange={(event) => setScopeIncludeText(event.target.value)}
                        placeholder="One project-relative path per line"
                      />
                    </label>
                    <label>
                      Exclude
                      <textarea
                        disabled={Boolean(startupState.seal)}
                        value={scopeExcludeText}
                        onChange={(event) => setScopeExcludeText(event.target.value)}
                        placeholder="One project-relative path per line"
                      />
                    </label>
                    <label>
                      Explicit files
                      <textarea
                        disabled={Boolean(startupState.seal)}
                        value={scopeExplicitFilesText}
                        onChange={(event) => setScopeExplicitFilesText(event.target.value)}
                        placeholder="Optional: one file per line"
                      />
                    </label>
                  </div>

                  {!startupState.seal ? (
                    <div className="startup-scope-actions">
                      <button
                        className="primary-action"
                        type="button"
                        disabled={
                          isRunning ||
                          startupState.scope.status !== "pending_approval" ||
                          unresolvedStartupDecisions.length > 0
                        }
                        onClick={() => void approveScopeAndContinue()}
                      >
                        Approve scope & seal workspace
                      </button>
                      <button
                        type="button"
                        disabled={isRunning || !activeProject || !selectedProvider}
                        onClick={() => {
                          if (!activeProject || !selectedProvider) return;
                          setStartupMessage("Requesting a fresh AI scope proposal...");
                          void runCloudJob(
                            activeProject,
                            selectedProvider,
                            selectedModel,
                            "010-startup",
                            true
                          ).then(() => loadStartupState());
                        }}
                      >
                        Regenerate with AI
                      </button>
                    </div>
                  ) : (
                    <dl className="startup-seal-summary">
                      <div><dt>Files</dt><dd>{startupState.seal.file_count}</dd></div>
                      <div><dt>Workspace hash</dt><dd><code>{startupState.seal.workspace_hash}</code></dd></div>
                      <div><dt>Scope hash</dt><dd><code>{startupState.seal.scope_hash}</code></dd></div>
                    </dl>
                  )}

                  {startupMessage ? <p className="startup-scope-message">{startupMessage}</p> : null}
                </>
              )}
            </section>
          ) : null}


        </div>
      </section>
    </div>
  );
};
