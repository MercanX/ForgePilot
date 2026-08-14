import { create } from "zustand";

import type { JobRunResponse, WorkflowResponse } from "@shared/schemas/cloud-api";
import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

type JobStoreState = {
  activityEntries: string[];
  cloudMessage: string;
  connected: boolean;
  currentOperation: string;
  errorMessage: string | null;
  isRunning: boolean;
  lastRun: JobRunResponse | null;
  runProgress: number;
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

const getStartupActivity = (project: Project): string[] => [
  "010-Startup started.",
  `Checking the .ai-factory directory under ${project.rootPath}.`,
  "Reading or creating factory.config.yaml according to RULE-A02.",
  "Reloading rule files in mock cloud and preparing the LLM verification prompt.",
  "Waiting for the LLM verification result.",
  "If Job 1 passes, selecting the AI Factory run folder with RULE-A03.",
  "If Job 2 passes, placing SCOPE.md and BASELINE.md with RULE-A04."
];

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
    const isStartupStage = stageId === "010-startup";
    const timers: NodeJS.Timeout[] = [];
    const activityEntries = isStartupStage
      ? getStartupActivity(project)
      : ["Stage run started.", "Preparing the cloud job.", "Waiting for the LLM result."];

    set({
      activityEntries,
      currentOperation: activityEntries[0] ?? "Stage run started.",
      errorMessage: null,
      isRunning: true,
      runProgress: 8
    });

    const queueProgress = (
      delayMs: number,
      runProgress: number,
      currentOperation: string
    ): void => {
      timers.push(
        setTimeout(() => {
          set({ currentOperation, runProgress });
        }, delayMs)
      );
    };

    queueProgress(350, 24, activityEntries[1] ?? "Preparing local files.");
    queueProgress(900, 42, activityEntries[2] ?? "Reading config.");
    queueProgress(1_500, 62, activityEntries[3] ?? "Preparing prompt.");
    queueProgress(2_200, 78, activityEntries[4] ?? "Waiting for LLM result.");
    queueProgress(3_200, 88, activityEntries[5] ?? "Selecting run folder.");
    queueProgress(4_400, 94, activityEntries[6] ?? "Placing input files.");

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
      set({
        activityEntries: [...activityEntries, "Stage run completed; the result is shown below."],
        cloudMessage: "Last job completed",
        connected: true,
        currentOperation: "Stage completed",
        isRunning: false,
        lastRun,
        runProgress: 100
      });
      await useJobStore.getState().loadWorkflow(project.id);
    } catch (error) {
      set({
        activityEntries: [...activityEntries, "Stage run stopped with an error."],
        cloudMessage: "Job failed",
        currentOperation: "Stage failed",
        errorMessage: getErrorMessage(error),
        isRunning: false,
        runProgress: 0
      });
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
  }
}));
