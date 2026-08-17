import { create } from "zustand";

import type {
  JobRunProgressEvent,
  JobRunResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import type { JobProviderDebugEvent } from "@shared/schemas/job";
import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";
import type { StageRepairState } from "@shared/schemas/repair";

import { useSettingsStore } from "./settingsStore";

export type ActivityEntry = {
  message: string;
  status: JobRunProgressEvent["status"];
  stepId: string;
};

type JobStoreState = {
  activityEntries: ActivityEntry[];
  cloudMessage: string;
  connected: boolean;
  currentOperation: string;
  debugEvents: JobProviderDebugEvent[];
  errorMessage: string | null;
  isRunning: boolean;
  lastRun: JobRunResponse | null;
  providerRetryWaiting: boolean;
  runProgress: number;
  runningStageId: string | null;
  workflow: WorkflowResponse | null;
  repairState: StageRepairState | null;
  clearDebugEvents: () => void;
  loadRepairState: (projectRootPath: string, stageId: string) => Promise<void>;
  importRepairJson: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
    stageId: string,
    workingJson: string,
    serverUrl?: string
  ) => Promise<void>;
  validateRepairJson: (projectRootPath: string, stageId: string, workingJson: string) => Promise<void>;
  manualRepair: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
    stageId: string,
    serverUrl?: string
  ) => Promise<void>;
  saveRepair: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
    stageId: string,
    serverUrl?: string
  ) => Promise<void>;
  checkCloud: (serverUrl?: string) => Promise<void>;
  loadWorkflow: (projectId: string, rootPath: string) => Promise<void>;
  retryProviderNow: (projectId: string, stageId: string) => Promise<void>;
  runCloudJob: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
    stageId: string | null,
    newRun?: boolean,
    serverUrl?: string
  ) => Promise<void>;
};

const DEFAULT_SERVER_URL = "http://localhost:4317";

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Cloud job failed.";

const getFinalOperation = (
  lastRun: JobRunResponse
): { message: string; progress: number; status: ActivityEntry["status"] } => ({
  message: lastRun.stageOutcome.message,
  progress: lastRun.stageOutcome.progress,
  status: lastRun.stageOutcome.status
});

const createActivityEntry = (
  stepId: string,
  message: string,
  status: JobRunProgressEvent["status"]
): ActivityEntry => ({
  message,
  status,
  stepId
});

const providerRetryWaitingFromProgress = (
  current: boolean,
  event: JobRunProgressEvent
): boolean => {
  if (event.stepId.startsWith("provider-retry-wait:")) return true;
  if (
    event.stepId.startsWith("provider-retry-attempt:") ||
    event.stepId.startsWith("provider-retry-recovered:")
  ) {
    return false;
  }
  return current;
};

const applyProgressEvent = (
  activityEntries: ActivityEntry[],
  event: JobRunProgressEvent
): ActivityEntry[] => {
  const existingIndex = activityEntries.findIndex((entry) => entry.stepId === event.stepId);
  const nextEntry = createActivityEntry(event.stepId, event.message, event.status);

  if (existingIndex === -1) {
    return [...activityEntries, nextEntry];
  }

  return activityEntries.map((entry, index) => (index === existingIndex ? nextEntry : entry));
};

export const useJobStore = create<JobStoreState>((set) => ({
  activityEntries: [],
  cloudMessage: "Not connected",
  connected: false,
  currentOperation: "Ready",
  debugEvents: [],
  errorMessage: null,
  isRunning: false,
  lastRun: null,
  providerRetryWaiting: false,
  runProgress: 0,
  runningStageId: null,
  workflow: null,
  repairState: null,

  clearDebugEvents: () => set({ debugEvents: [] }),

  loadRepairState: async (projectRootPath, stageId) => {
    try {
      const repairState = await window.forgepilot.jobs.repairState(projectRootPath, stageId);
      set({ repairState });
    } catch {
      set({ repairState: null });
    }
  },

  importRepairJson: async (
    project,
    provider,
    model,
    stageId,
    workingJson,
    serverUrl = DEFAULT_SERVER_URL
  ) => {
    set({
      currentOperation: "Loading existing JSON into Repair workspace.",
      errorMessage: null,
      isRunning: true,
      runningStageId: stageId
    });
    const removeProgressListener = window.forgepilot.jobs.onProgress((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({
        activityEntries: applyProgressEvent(state.activityEntries, event),
        currentOperation: event.message,
        runProgress: Math.max(state.runProgress, event.progress)
      }));
    });
    const removeDebugListener = window.forgepilot.jobs.onDebug((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({ debugEvents: [...state.debugEvents, event].slice(-5000) }));
    });
    try {
      const executionSettings = useSettingsStore.getState().settings;
      const repairState = await window.forgepilot.jobs.repairImport({
        model,
        newRun: false,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        workingJson,
        outputLanguage: executionSettings.aiOutputLanguage,
        timeoutMs: executionSettings.providerStageTimeoutMinutes * 60_000
      });
      set({
        currentOperation:
          repairState.validationErrors.length === 0
            ? "Existing JSON loaded. Ready to save without rerunning the audit."
            : "Existing JSON loaded. Repair only the reported errors.",
        isRunning: false,
        repairState,
        runningStageId: null
      });
    } catch (error) {
      set({
        errorMessage: getErrorMessage(error),
        isRunning: false,
        runningStageId: null
      });
    } finally {
      removeProgressListener();
      removeDebugListener();
    }
  },

  validateRepairJson: async (projectRootPath, stageId, workingJson) => {
    try {
      const repairState = await window.forgepilot.jobs.repairValidate(
        projectRootPath,
        stageId,
        workingJson
      );
      set({ errorMessage: null, repairState });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error) });
    }
  },

  checkCloud: async (serverUrl = DEFAULT_SERVER_URL) => {
    try {
      const status = await window.forgepilot.jobs.status({ serverUrl });
      set({
        cloudMessage: status.connected
          ? `Connected (${status.serverVersion ?? "unknown"})`
          : status.message,
        connected: status.connected,
        errorMessage: null
      });
    } catch (error) {
      set({
        cloudMessage: "Not connected",
        connected: false,
        errorMessage: getErrorMessage(error)
      });
    }
  },

  loadWorkflow: async (projectId, rootPath) => {
    try {
      const workflow = await window.forgepilot.jobs.workflow(projectId, rootPath);
      set({ errorMessage: null, workflow });
    } catch (error) {
      set({
        errorMessage: getErrorMessage(error),
        workflow: null
      });
    }
  },

  manualRepair: async (
    project,
    provider,
    model,
    stageId,
    serverUrl = DEFAULT_SERVER_URL
  ) => {
    set({
      currentOperation: "Manual JSON repair requested.",
      errorMessage: null,
      isRunning: true,
      runningStageId: stageId
    });
    const removeProgressListener = window.forgepilot.jobs.onProgress((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({
        activityEntries: applyProgressEvent(state.activityEntries, event),
        currentOperation: event.message,
        runProgress: Math.max(state.runProgress, event.progress)
      }));
    });
    const removeDebugListener = window.forgepilot.jobs.onDebug((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({ debugEvents: [...state.debugEvents, event].slice(-5000) }));
    });
    try {
      const executionSettings = useSettingsStore.getState().settings;
      const repairState = await window.forgepilot.jobs.repairManual({
        model,
        newRun: false,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        outputLanguage: executionSettings.aiOutputLanguage,
        timeoutMs: executionSettings.providerStageTimeoutMinutes * 60_000
      });
      set({
        currentOperation:
          repairState.validationErrors.length === 0
            ? "Manual repair validated. Ready to save."
            : "Manual repair finished with remaining validation errors.",
        isRunning: false,
        repairState,
        runningStageId: null
      });
    } catch (error) {
      set({
        errorMessage: getErrorMessage(error),
        isRunning: false,
        runningStageId: null
      });
    } finally {
      removeProgressListener();
      removeDebugListener();
    }
  },

  saveRepair: async (
    project,
    provider,
    model,
    stageId,
    serverUrl = DEFAULT_SERVER_URL
  ) => {
    set({
      currentOperation: "Saving validated repaired JSON.",
      errorMessage: null,
      isRunning: true,
      runningStageId: stageId
    });
    const removeProgressListener = window.forgepilot.jobs.onProgress((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({
        activityEntries: applyProgressEvent(state.activityEntries, event),
        currentOperation: event.message,
        runProgress: Math.max(state.runProgress, event.progress)
      }));
    });
    const removeDebugListener = window.forgepilot.jobs.onDebug((event) => {
      if (event.projectId !== project.id || event.stageId !== stageId) return;
      set((state) => ({ debugEvents: [...state.debugEvents, event].slice(-5000) }));
    });
    try {
      const executionSettings = useSettingsStore.getState().settings;
      const lastRun = await window.forgepilot.jobs.repairSave({
        model,
        newRun: false,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        outputLanguage: executionSettings.aiOutputLanguage,
        timeoutMs: executionSettings.providerStageTimeoutMinutes * 60_000
      });
      const finalOperation = getFinalOperation(lastRun);
      set({
        currentOperation: finalOperation.message,
        isRunning: false,
        lastRun,
        providerRetryWaiting: false,
        runProgress: finalOperation.progress,
        runningStageId: null
      });
      await useJobStore.getState().loadWorkflow(project.id, project.rootPath);
      await useJobStore.getState().loadRepairState(project.rootPath, stageId);
    } catch (error) {
      set({
        errorMessage: getErrorMessage(error),
        isRunning: false,
        runningStageId: null
      });
      await useJobStore.getState().loadRepairState(project.rootPath, stageId);
    } finally {
      removeProgressListener();
      removeDebugListener();
    }
  },

  retryProviderNow: async (projectId, stageId) => {
    try {
      const response = await window.forgepilot.jobs.retryProviderNow(projectId, stageId);
      set({
        currentOperation: response.message,
        errorMessage: response.accepted ? null : response.message
      });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error) });
    }
  },

  runCloudJob: async (
    project,
    provider,
    model,
    stageId,
    newRun = false,
    serverUrl = DEFAULT_SERVER_URL
  ) => {
    set((state) => {
      const stageIndex = state.workflow?.stages.findIndex((stage) => stage.id === stageId) ?? -1;
      const workflow =
        state.workflow && stageIndex >= 0
          ? {
              ...state.workflow,
              stages: state.workflow.stages.map((stage, index) => {
                if (index === stageIndex) {
                  return {
                    ...stage,
                    activity: newRun ? [] : stage.activity,
                    currentOperation: "Stage run requested.",
                    progress: 2,
                    report: newRun ? null : stage.report,
                    status: "running" as const
                  };
                }

                if (newRun && stageId === "010-startup" && index > stageIndex) {
                  return {
                    ...stage,
                    activity: [],
                    currentAgent: null,
                    currentOperation: null,
                    progress: 0,
                    report: null,
                    status: "waiting" as const
                  };
                }

                return stage;
              })
            }
          : state.workflow;

      return {
        activityEntries: [],
        currentOperation: "Stage run requested.",
        errorMessage: null,
        debugEvents: [],
        isRunning: true,
        lastRun: null,
        providerRetryWaiting: false,
        runProgress: 2,
        runningStageId: stageId,
        workflow
      };
    });

    const removeProgressListener = window.forgepilot.jobs.onProgress(
      (event: JobRunProgressEvent) => {
        if (
          event.projectId !== project.id ||
          (stageId !== null && event.stageId !== stageId)
        ) {
          return;
        }

        set((state) => ({
          activityEntries: applyProgressEvent(state.activityEntries, event),
          currentOperation: event.status === "completed" ? state.currentOperation : event.message,
          providerRetryWaiting: providerRetryWaitingFromProgress(
            state.providerRetryWaiting,
            event
          ),
          runProgress: Math.max(state.runProgress, event.progress)
        }));
      }
    );

    const removeDebugListener = window.forgepilot.jobs.onDebug((event) => {
      if (
        event.projectId !== project.id ||
        (stageId !== null && event.stageId !== stageId)
      ) {
        return;
      }

      set((state) => ({
        debugEvents: [...state.debugEvents, event].slice(-5000)
      }));
    });

    try {
      const executionSettings = useSettingsStore.getState().settings;
      const lastRun = await window.forgepilot.jobs.runOnce({
        model,
        newRun,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        outputLanguage: executionSettings.aiOutputLanguage,
        timeoutMs: executionSettings.providerStageTimeoutMinutes * 60_000
      });
      const finalOperation = getFinalOperation(lastRun);
      set({
        activityEntries: [
          ...useJobStore.getState().activityEntries,
          createActivityEntry("stage-result", finalOperation.message, finalOperation.status)
        ],
        cloudMessage:
          finalOperation.status === "completed"
            ? "Last stage completed"
            : finalOperation.status === "blocked"
              ? "Waiting for input"
              : "Stage failed",
        connected: true,
        currentOperation: finalOperation.message,
        isRunning: false,
        lastRun,
        providerRetryWaiting: false,
        runProgress: finalOperation.progress,
        runningStageId: null
      });
      await useJobStore.getState().loadWorkflow(project.id, project.rootPath);
      if (stageId) {
        await useJobStore.getState().loadRepairState(project.rootPath, stageId);
      }
    } catch (error) {
      set({
        activityEntries: [
          ...useJobStore.getState().activityEntries,
          createActivityEntry("stage-result", "Stage run stopped with an error.", "failed")
        ],
        cloudMessage: "Job failed",
        currentOperation: "Stage failed",
        errorMessage: getErrorMessage(error),
        isRunning: false,
        providerRetryWaiting: false,
        runProgress: 0,
        runningStageId: null
      });
    } finally {
      removeProgressListener();
      removeDebugListener();
    }
  }
}));
