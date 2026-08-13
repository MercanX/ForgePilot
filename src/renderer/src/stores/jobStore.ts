import { create } from "zustand";

import type { JobRunResponse } from "@shared/schemas/cloud-api";
import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

type JobStoreState = {
  cloudMessage: string;
  connected: boolean;
  errorMessage: string | null;
  isRunning: boolean;
  lastRun: JobRunResponse | null;
  checkCloud: (serverUrl?: string) => Promise<void>;
  runCloudJob: (
    project: Project,
    provider: ProviderDetectionResult,
    model: string | null,
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

  runCloudJob: async (project, provider, model, serverUrl = DEFAULT_SERVER_URL) => {
    set({ errorMessage: null, isRunning: true });

    try {
      const lastRun = await window.forgepilot.jobs.runOnce({
        model,
        project,
        providerId: provider.id,
        serverUrl,
        timeoutMs: 300_000
      });
      set({
        cloudMessage: "Last job completed",
        connected: true,
        isRunning: false,
        lastRun
      });
    } catch (error) {
      set({
        cloudMessage: "Job failed",
        errorMessage: getErrorMessage(error),
        isRunning: false
      });
    }
  }
}));
