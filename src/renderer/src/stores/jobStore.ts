import { create } from "zustand";

import type { JobRunResponse, WorkflowResponse } from "@shared/schemas/cloud-api";
import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

type JobStoreState = {
  cloudMessage: string;
  connected: boolean;
  errorMessage: string | null;
  isRunning: boolean;
  lastRun: JobRunResponse | null;
  workflow: WorkflowResponse | null;
  checkCloud: (serverUrl?: string) => Promise<void>;
  loadWorkflow: (projectId: string) => Promise<void>;
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

export const useJobStore = create<JobStoreState>((set) => ({
  cloudMessage: "Not connected",
  connected: false,
  errorMessage: null,
  isRunning: false,
  lastRun: null,
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

  loadWorkflow: async (projectId) => {
    try {
      const workflow = await window.forgepilot.jobs.workflow(projectId);
      set({ errorMessage: null, workflow });
    } catch (error) {
      set({
        errorMessage: getErrorMessage(error),
        workflow: null
      });
    }
  },

  runCloudJob: async (project, provider, model, stageId, serverUrl = DEFAULT_SERVER_URL) => {
    set({ errorMessage: null, isRunning: true });

    try {
      const lastRun = await window.forgepilot.jobs.runOnce({
        model,
        project,
        providerId: provider.id,
        serverUrl,
        stageId,
        timeoutMs: 300_000
      });
      set({
        cloudMessage: "Last job completed",
        connected: true,
        isRunning: false,
        lastRun
      });
      await useJobStore.getState().loadWorkflow(project.id);
    } catch (error) {
      set({
        cloudMessage: "Job failed",
        errorMessage: getErrorMessage(error),
        isRunning: false
      });
    }
  }
}));
