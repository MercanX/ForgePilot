import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  JobRunProgressEvent,
  JobRunResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import type {
  StageActivityEntry,
  StageReport,
  WorkflowStage
} from "@shared/schemas/run";

import { runD05StatusJob } from "../discovery/discoverySubstageService";
import { runScopeStatusJob } from "../startup/startupJobService";

const STATE_RELATIVE_PATH = path.join(".forgepilot", "ai-factory-state.json");
const MAX_ACTIVITY_ENTRIES = 50;

type StoredStageState = {
  activity: StageActivityEntry[];
  report: StageReport | null;
  status: "running" | "completed" | "failed";
  updatedAt: string;
};

type ProjectStateDocument = {
  schemaVersion: 1;
  stages: Record<string, StoredStageState>;
  updatedAt: string;
};

export type ProjectWorkflowState = {
  beginStage: (stages: WorkflowStage[], stageId: string, restart: boolean) => Promise<void>;
  failStage: (stageId: string, message: string) => Promise<void>;
  finishStage: (response: JobRunResponse) => Promise<void>;
  mergeWorkflow: (workflow: WorkflowResponse) => Promise<WorkflowResponse>;
  recordProgress: (event: JobRunProgressEvent) => Promise<void>;
};

const emptyState = (): ProjectStateDocument => ({
  schemaVersion: 1,
  stages: {},
  updatedAt: new Date(0).toISOString()
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseActivity = (value: unknown): StageActivityEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is StageActivityEntry => {
    if (!isObject(item)) {
      return false;
    }

    return (
      typeof item.message === "string" &&
      typeof item.stepId === "string" &&
      typeof item.updatedAt === "string" &&
      ["started", "completed", "blocked", "failed", "skipped"].includes(
        String(item.status)
      )
    );
  });
};

const parseReport = (value: unknown): StageReport | null => {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value.completedAt !== "string" ||
    !(typeof value.executionId === "string" || value.executionId === null) ||
    typeof value.message !== "string" ||
    !["completed", "blocked", "failed"].includes(String(value.outcome)) ||
    typeof value.progress !== "number"
  ) {
    return null;
  }

  return value as StageReport;
};

const parseDocument = (value: unknown): ProjectStateDocument => {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.stages)) {
    return emptyState();
  }

  const stages: Record<string, StoredStageState> = {};

  for (const [stageId, raw] of Object.entries(value.stages)) {
    if (!isObject(raw)) {
      continue;
    }

    const status = String(raw.status);
    if (!["running", "completed", "failed"].includes(status)) {
      continue;
    }

    stages[stageId] = {
      activity: parseActivity(raw.activity),
      report: parseReport(raw.report),
      status: status as StoredStageState["status"],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
    };
  }

  return {
    schemaVersion: 1,
    stages,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
  };
};

export const createProjectWorkflowState = (projectRootPath: string): ProjectWorkflowState => {
  const statePath = path.join(projectRootPath, STATE_RELATIVE_PATH);

  const factoryExists = async (): Promise<boolean> => {
    try {
      await access(path.join(projectRootPath, ".ai-factory"));
      return true;
    } catch {
      return false;
    }
  };

  const read = async (): Promise<ProjectStateDocument> => {
    try {
      return parseDocument(JSON.parse(await readFile(statePath, "utf8")) as unknown);
    } catch {
      return emptyState();
    }
  };

  const write = async (document: ProjectStateDocument): Promise<void> => {
    const directory = path.dirname(statePath);
    const temporaryPath = `${statePath}.tmp`;
    document.updatedAt = new Date().toISOString();
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, statePath);
  };

  return {
    beginStage: async (stages, stageId, restart) => {
      // If .ai-factory was deleted manually, the old state file is stale and
      // this run starts from a clean workflow state.
      const document = (await factoryExists()) ? await read() : emptyState();
      const stageIndex = stages.findIndex((stage) => stage.id === stageId);

      if (stageIndex === -1) {
        throw new Error(`Unknown workflow stage: ${stageId}`);
      }

      if (restart) {
        if (stageId === "010-startup") {
          for (const stage of stages.slice(stageIndex)) {
            delete document.stages[stage.id];
          }
        } else {
          // Discovery sub-stages restart independently. Restarting D05 must not
          // erase unrelated completed sub-stages or later workflow state.
          delete document.stages[stageId];
        }
      }

      const current = document.stages[stageId];
      document.stages[stageId] = {
        activity: restart ? [] : (current?.activity ?? []),
        report: restart ? null : (current?.report ?? null),
        status: "running",
        updatedAt: new Date().toISOString()
      };
      await write(document);
    },

    failStage: async (stageId, message) => {
      const document = await read();
      const current = document.stages[stageId];
      document.stages[stageId] = {
        activity: current?.activity ?? [],
        report: {
          completedAt: new Date().toISOString(),
          executionId: null,
          message,
          outcome: "failed",
          progress: 0
        },
        status: "failed",
        updatedAt: new Date().toISOString()
      };
      await write(document);
    },

    finishStage: async (response) => {
      const document = await read();
      const stageId = response.stageOutcome.stageId;
      const current = document.stages[stageId];
      const outcome = response.stageOutcome.status;

      document.stages[stageId] = {
        activity: current?.activity ?? [],
        report: {
          completedAt: new Date().toISOString(),
          executionId: response.stageOutcome.executionId,
          message: response.stageOutcome.message,
          outcome,
          progress: response.stageOutcome.progress
        },
        status: outcome === "completed" ? "completed" : outcome === "failed" ? "failed" : "running",
        updatedAt: new Date().toISOString()
      };

      // "blocked" means the stage is not finished. Keeping it as running in the
      // stored file lets mergeWorkflow expose it as ready on the next app load.
      await write(document);
    },

    mergeWorkflow: async (workflow) => {
      // The cloud owns the stage catalog/directives, but readiness for local
      // artifact-backed prerequisites must follow the real project state.
      // In particular, D05 is runnable as soon as 010 has a valid sealed
      // workspace even if the mock-cloud process lost its in-memory/pass state.
      const exists = await factoryExists();
      if (!exists) {
        return {
          ...workflow,
          stages: workflow.stages.map((stage) =>
            stage.id === "010-startup"
              ? {
                  ...stage,
                  activity: [],
                  currentOperation: "Waiting for execution directive",
                  progress: 0,
                  report: null,
                  status: "ready" as const
                }
              : {
                  ...stage,
                  activity: [],
                  currentAgent: null,
                  currentOperation: null,
                  progress: 0,
                  report: null,
                  status: "waiting" as const
                }
          )
        };
      }

      const document = await read();
      const startupStatus = await runScopeStatusJob(projectRootPath, false);
      const startupSealed = startupStatus.sealed;
      let d05Completed = false;
      if (startupSealed) {
        try {
          d05Completed = (await runD05StatusJob(projectRootPath, false)).state === "completed";
        } catch {
          d05Completed = false;
        }
      }
      const stages = workflow.stages.map((stage): WorkflowStage => {
        const local = document.stages[stage.id];

        // Startup completion is artifact-backed. A valid STARTUP_SEAL is the
        // source of truth, not the lifetime of the mock-cloud process.
        if (stage.id === "010-startup" && startupSealed) {
          return {
            ...stage,
            activity: local?.activity ?? stage.activity,
            currentAgent: stage.currentAgent ?? "Startup Agent",
            currentOperation: local?.report?.message ?? "Workspace sealed.",
            progress: 100,
            report: local?.report ?? stage.report,
            status: "completed"
          };
        }

        // D05 depends directly on the sealed 010 workspace. 020-Discovery is
        // not an executable container stage and mock-cloud restart state must
        // never leave D05 stuck in Waiting after Startup is actually complete.
        if (stage.id === "020-d05-project-overview" && !local) {
          return {
            ...stage,
            currentAgent: startupSealed ? "D05 Project Overview Agent" : null,
            currentOperation: startupSealed ? "Ready for manual start." : null,
            progress: 0,
            status: startupSealed ? "ready" : "waiting"
          };
        }

        // D10 is a real executable Discovery sub-stage. It is never auto-run.
        // Its only required prerequisite is a completed D05 snapshot for the
        // same sealed workspace; local audit artifacts are the readiness truth.
        if (stage.id === "020-d10-architecture" && !local) {
          return {
            ...stage,
            currentAgent: d05Completed ? "D10 Architecture Agent" : null,
            currentOperation: d05Completed ? "Ready for manual start." : "Run D05 Project Overview first.",
            progress: 0,
            status: d05Completed ? "ready" : "waiting"
          };
        }

        if (!local) {
          return stage;
        }

        if (local.status === "completed") {
          return {
            ...stage,
            activity: local.activity,
            currentOperation: local.report?.message ?? "Completed",
            progress: 100,
            report: local.report,
            status: "completed"
          };
        }

        if (local.status === "failed") {
          return {
            ...stage,
            activity: local.activity,
            currentOperation: local.report?.message ?? stage.currentOperation,
            progress: stage.progress ?? 0,
            report: local.report,
            status: "failed"
          };
        }

        return {
          ...stage,
          activity: local.activity,
          currentOperation: local.report?.message ?? "Ready to continue or restart",
          progress: stage.progress ?? 0,
          report: local.report,
          status:
            stage.id === "020-d05-project-overview" && startupSealed
              ? "ready"
              : stage.status === "waiting"
                ? "waiting"
                : "ready"
        };
      });

      return { ...workflow, stages };
    },

    recordProgress: async (event) => {
      if (!event.stageId) {
        return;
      }

      const document = await read();
      const current = document.stages[event.stageId] ?? {
        activity: [],
        report: null,
        status: "running" as const,
        updatedAt: new Date().toISOString()
      };
      const entry: StageActivityEntry = {
        message: event.message,
        status: event.status,
        stepId: event.stepId,
        updatedAt: new Date().toISOString()
      };
      const existingIndex = current.activity.findIndex((item) => item.stepId === event.stepId);
      const activity =
        existingIndex === -1
          ? [...current.activity, entry]
          : current.activity.map((item, index) => (index === existingIndex ? entry : item));

      document.stages[event.stageId] = {
        ...current,
        activity: activity.slice(-MAX_ACTIVITY_ENTRIES),
        status: "running",
        updatedAt: new Date().toISOString()
      };
      await write(document);
    }
  };
};
