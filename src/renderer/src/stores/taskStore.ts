import { create } from "zustand";

import type { Project } from "@shared/schemas/project";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

type TaskLogLine = {
  id: string;
  stream: "exit" | "stderr" | "stdout";
  text: string;
};

type TaskStoreState = {
  activeTaskId: string | null;
  errorMessage: string | null;
  isRunning: boolean;
  lines: TaskLogLine[];
  startEchoTask: (
    project: Project,
    provider: ProviderDetectionResult,
    instructions: string,
    model: string | null
  ) => Promise<void>;
  startProviderTask: (
    project: Project,
    provider: ProviderDetectionResult,
    instructions: string,
    model: string | null
  ) => Promise<void>;
  stopTask: () => Promise<void>;
};

const MAX_LINES = 2_000;

const appendLine = (lines: TaskLogLine[], line: TaskLogLine): TaskLogLine[] =>
  [...lines, line].slice(-MAX_LINES);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Task action failed.";

const startTask = async (
  project: Project,
  provider: ProviderDetectionResult,
  instructions: string,
  model: string | null,
  mode: "echo-fixture" | "provider",
  timeoutMs: number
): Promise<void> => {
  const response = await window.forgepilot.tasks.start({
    instructions: {
      body: instructions,
      format: "plain-text",
      metadata: {}
    },
    model,
    mode,
    outputJsonSchema: null,
    projectRootPath: project.rootPath,
    providerId: provider.id,
    timeoutMs
  });
  useTaskStore.setState({ activeTaskId: response.handle.id });
};

export const useTaskStore = create<TaskStoreState>((set, get) => {
  window.forgepilot.tasks.onOutput((event) => {
    set((state) => ({
      lines: appendLine(state.lines, {
        id: crypto.randomUUID(),
        stream: event.chunk.stream,
        text: event.chunk.text
      })
    }));
  });

  window.forgepilot.tasks.onExit((event) => {
    set((state) => ({
      activeTaskId: state.activeTaskId === event.taskId ? null : state.activeTaskId,
      isRunning: state.activeTaskId === event.taskId ? false : state.isRunning,
      lines: appendLine(state.lines, {
        id: crypto.randomUUID(),
        stream: "exit",
        text: `Process exited with code ${event.exitInfo.exitCode ?? "n/a"} (${event.exitInfo.signal ?? "no signal"})`
      })
    }));
  });

  return {
    activeTaskId: null,
    errorMessage: null,
    isRunning: false,
    lines: [],

    startEchoTask: async (project, provider, instructions, model) => {
      set({ errorMessage: null, isRunning: true, lines: [] });

      try {
        await startTask(project, provider, instructions, model, "echo-fixture", 30_000);
      } catch (error) {
        set({ errorMessage: getErrorMessage(error), isRunning: false });
      }
    },

    startProviderTask: async (project, provider, instructions, model) => {
      set({ errorMessage: null, isRunning: true, lines: [] });

      try {
        await startTask(project, provider, instructions, model, "provider", 300_000);
      } catch (error) {
        set({ errorMessage: getErrorMessage(error), isRunning: false });
      }
    },

    stopTask: async () => {
      const taskId = get().activeTaskId;

      if (!taskId) {
        return;
      }

      try {
        await window.forgepilot.tasks.stop(taskId);
      } catch (error) {
        set({ errorMessage: getErrorMessage(error) });
      }
    }
  };
});
