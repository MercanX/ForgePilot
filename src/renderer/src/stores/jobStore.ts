import { create } from "zustand";

import type {
  JobRunProgressEvent,
  JobRunResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

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
  errorMessage: string | null;
  isRunning: boolean;
  lastRun: JobRunResponse | null;
  runProgress: number;
  workflow: WorkflowResponse | null;
  checkCloud: (serverUrl?: string) => Promise<void>;
  loadWorkflow: (projectId: string, rootPath: string) => Promise<void>;
  runCloudJob: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
    stageId: string | null,
    serverUrl?: string
  ) => Promise<void>;
};

const DEFAULT_SERVER_URL = "http://localhost:4317";

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Cloud job failed.";

type StartupExecutionMetadata = {
  place_inputs?: {
    status?: string;
  };
  seal_run?: {
    decision?: string;
  };
  select_run?: {
    decision?: string;
  };
};

const isStartupExecutionMetadata = (value: unknown): value is StartupExecutionMetadata =>
  typeof value === "object" && value !== null;

const getFinalOperation = (
  lastRun: JobRunResponse
): { message: string; progress: number; status: ActivityEntry["status"] } => {
  const metadata = lastRun.job.task?.instructions.metadata.localExecution;

  if (isStartupExecutionMetadata(metadata)) {
    if (metadata.seal_run?.decision === "FAIL") {
      return {
        message: "Startup seal failed; review the missing files.",
        progress: 100,
        status: "blocked"
      };
    }

    if (metadata.place_inputs?.status === "waiting_for_input") {
      return {
        message: "Waiting for input review.",
        progress: 86,
        status: "blocked"
      };
    }

    if (metadata.select_run?.decision === "already_sealed") {
      return {
        message: "A valid sealed run already exists.",
        progress: 100,
        status: "completed"
      };
    }
  }

  return {
    message: "Stage completed.",
    progress: 100,
    status: "completed"
  };
};

const createActivityEntry = (
  stepId: string,
  message: string,
  status: JobRunProgressEvent["status"]
): ActivityEntry => ({
  message,
  status,
  stepId
});

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
  errorMessage: null,
  isRunning: false,
  lastRun: null,
  runProgress: 0,
  workflow: null,

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

  runCloudJob: async (project, provider, model, stageId, serverUrl = DEFAULT_SERVER_URL) => {
    set({
      activityEntries: [],
      currentOperation: "Stage run requested.",
      errorMessage: null,
      isRunning: true,
      lastRun: null,
      runProgress: 2
    });

    const removeProgressListener = window.forgepilot.jobs.onProgress(
      (event: JobRunProgressEvent) => {
        if (event.projectId !== project.id || event.stageId !== stageId) {
          return;
        }

        set((state) => ({
          activityEntries: applyProgressEvent(state.activityEntries, event),
          currentOperation: event.status === "completed" ? state.currentOperation : event.message,
          runProgress: Math.max(state.runProgress, event.progress)
        }));
      }
    );

    try {
      const lastRun = await window.forgepilot.jobs.runOnce({
        model,
        newRun: false,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        timeoutMs: 300_000
      });
      const finalOperation = getFinalOperation(lastRun);
      set({
        activityEntries: [
          ...useJobStore.getState().activityEntries,
          createActivityEntry("stage-result", finalOperation.message, finalOperation.status)
        ],
        cloudMessage:
          finalOperation.status === "completed" ? "Last job completed" : "Waiting for input",
        connected: true,
        currentOperation: finalOperation.message,
        isRunning: false,
        lastRun,
        runProgress: finalOperation.progress
      });
      await useJobStore.getState().loadWorkflow(project.id, project.rootPath);
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
        runProgress: 0
      });
    } finally {
      removeProgressListener();
    }
  }
}));
